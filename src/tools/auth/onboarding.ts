import type { ToolContext, ToolDefinition, ToolResult } from '../../types/mcp.js';
import { config } from '../../config/index.js';
import type { HudsonEnvelope } from '../../region/api.js';
import { handleToolError, MCPError, ErrorCode } from '../../utils/errorHandler.js';
import { resolveHandshakeOrigin } from './handshake.js';

export const AUTH_TOOL_NAMES = [
  'sign_up_check',
  'send_signup_email_code',
  'complete_sign_up',
  'sign_in',
] as const;

export type AuthToolName = (typeof AUTH_TOOL_NAMES)[number];

export function isAuthToolName(name: string): boolean {
  return (AUTH_TOOL_NAMES as readonly string[]).includes(name);
}

const BNB_LOGIN_MFA_REQUIRED = 'BNB_LOGIN_MFA_REQUIRED';
const BNB_LOGIN_MFA_RATE_LIMIT = 'BNB_LOGIN_MFA_RATE_LIMIT';

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (value == null) return '';
  return String(value).trim();
}

function isLoginMfaEnabled(): boolean {
  const flag = (process.env.LOCALSBNB_LOGIN_MFA || '').trim();
  if (flag === '0') return false;
  if (flag === '1') return true;
  return config.api.baseURL.includes('hudson-prod');
}

async function postAuth<T>(
  context: ToolContext,
  url: string,
  data: unknown
): Promise<HudsonEnvelope<T>> {
  return context.apiClient.request<HudsonEnvelope<T>>({
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/json' },
    data,
  });
}

function envelopeErrorText(response: HudsonEnvelope<unknown>, fallback: string): string {
  const code = String(response.errorCode ?? '').trim();
  const msg = String(response.errorMsg ?? '').trim();
  const detail = String(response.errorDetail ?? '').trim();
  const parts = [msg || fallback];
  if (code) parts.push(`errorCode=${code}`);
  if (detail && detail !== msg) parts.push(detail);
  return parts.join('\n');
}

interface SignUpCheckFieldMessage {
  field?: string;
  message?: string;
  boolean?: boolean;
}

function occupiedMessages(data: unknown, fields: string[]): string[] {
  if (!data || typeof data !== 'object') return [];
  const messages = (data as { errorMessages?: SignUpCheckFieldMessage[] }).errorMessages ?? [];
  const lines: string[] = [];
  for (const field of fields) {
    const entry = messages.find((item) => item.field === field);
    if (entry && entry.boolean === false) {
      lines.push(entry.message?.trim() || `${field} is already registered`);
    }
  }
  return lines;
}

async function loadFirstCampId(context: ToolContext, accessToken: string): Promise<string | null> {
  context.apiClient.setHudsonAccessToken?.(accessToken);
  const response = await postAuth<{ camps?: Array<{ campId?: string | number; name?: string }> }>(
    context,
    '/camps/get',
    {}
  );
  if (response.success !== true) {
    throw new MCPError(ErrorCode.API_ERROR, envelopeErrorText(response, 'Failed to load properties'), {
      errorCode: response.errorCode,
      errorMsg: response.errorMsg,
      errorDetail: response.errorDetail,
      action: 'camps/get',
    });
  }
  const camps = Array.isArray(response.data?.camps) ? response.data.camps : [];
  const first = camps.find((camp) => String(camp.campId ?? '').trim());
  return first ? String(first.campId).trim() : null;
}

function extractSecretToken(data: unknown): string {
  return String(data ?? '').trim();
}

/**
 * Login/sign-up JWT is short-lived (needs Bearer on the wire).
 * Persist only App Secret from /user/secret/get or /user/secret/generate (no Bearer),
 * same value users paste as APP_SECRET in mcp.json. Direct-config users never hit this path.
 */
async function loadOrCreateAppSecret(context: ToolContext, campId: string): Promise<string> {
  const existing = await postAuth<string>(context, '/user/secret/get', { campId });
  const existingToken = extractSecretToken(existing.data);
  if (existing.success === true && existingToken) {
    return existingToken;
  }

  const generated = await postAuth<string>(context, '/user/secret/generate', { campId });
  const appSecret = extractSecretToken(generated.data);
  if (generated.success !== true || !appSecret) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      envelopeErrorText(generated, 'Failed to create App Secret via /user/secret/generate'),
      {
        errorCode: generated.errorCode,
        errorMsg: generated.errorMsg,
        errorDetail: generated.errorDetail,
        action: 'user/secret/generate',
      }
    );
  }
  return appSecret;
}

async function persistSession(
  context: ToolContext,
  loginToken: string
): Promise<{ campId: string; campCountHint: string }> {
  if (!context.applyHudsonSession) {
    throw new MCPError(ErrorCode.INTERNAL_ERROR, 'Session persistence is not available in this MCP process');
  }
  const campId = await loadFirstCampId(context, loginToken);
  if (!campId) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      'Sign-in succeeded but no property (camp) was created. LocalsBnb tools need a campId. Ask the guest to retry later or contact LocalsBnb support.'
    );
  }
  const appSecret = await loadOrCreateAppSecret(context, campId);
  await context.applyHudsonSession(appSecret, campId);
  return {
    campId,
    campCountHint: `Saved App Secret locally to ~/.localsbnb/credentials.json (mode 600). Next MCP start can reuse it without APP_SECRET.`,
  };
}

export async function signUpCheckHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const email = str(args, 'email').toLowerCase();
  const mobile = str(args, 'mobile');
  const areaCode = str(args, 'areaCode');
  if (!email && !mobile) {
    throw new MCPError(ErrorCode.MISSING_PARAMS, 'Provide email and/or mobile');
  }
  if (mobile && !areaCode) {
    throw new MCPError(ErrorCode.MISSING_PARAMS, 'areaCode is required when checking a mobile number');
  }

  const body: Record<string, string> = {};
  if (email) body.email = email;
  if (mobile) {
    body.mobile = mobile;
    body.areaCode = areaCode;
  }

  const response = await postAuth<{ errorMessages?: SignUpCheckFieldMessage[] }>(
    context,
    '/user/bnb/sign-up/check',
    body
  );
  if (response.success !== true) {
    return textResult(envelopeErrorText(response, 'Sign-up check failed'), true);
  }

  const fields = [...(email ? ['email'] : []), ...(mobile ? ['mobile'] : [])];
  const occupied = occupiedMessages(response.data, fields);
  if (occupied.length) {
    return textResult(`This account cannot be registered:\n${occupied.join('\n')}\nIf the guest already has an account, use sign_in.`, true);
  }
  return textResult('Email/mobile is available. Next call send_signup_email_code with the same email plus name, listing count, country and phone.');
}

export async function sendSignupEmailCodeHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const email = str(args, 'email').toLowerCase();
  const nickName = str(args, 'nickName');
  const countryCode = str(args, 'countryCode');
  const mobile = str(args, 'mobile');
  const areaCode = str(args, 'areaCode');
  const houseNumRaw = args.houseNum;
  if (!email) throw new MCPError(ErrorCode.MISSING_PARAMS, 'email is required');
  if (!nickName) throw new MCPError(ErrorCode.MISSING_PARAMS, 'nickName is required');
  if (!countryCode) throw new MCPError(ErrorCode.MISSING_PARAMS, 'countryCode is required (ISO 3166-1 alpha-2, e.g. US, JP, TH)');
  if (!mobile) throw new MCPError(ErrorCode.MISSING_PARAMS, 'mobile is required');
  if (!areaCode) throw new MCPError(ErrorCode.MISSING_PARAMS, 'areaCode is required (e.g. +1, +81, +66)');

  let houseNum: number | undefined;
  if (houseNumRaw != null && houseNumRaw !== '') {
    houseNum = Number(houseNumRaw);
    if (!Number.isInteger(houseNum) || houseNum < 1) {
      throw new MCPError(ErrorCode.INVALID_PARAMS, 'houseNum must be an integer >= 1 (number of listings)');
    }
  }

  const check = await postAuth<{ errorMessages?: SignUpCheckFieldMessage[] }>(
    context,
    '/user/bnb/sign-up/check',
    { email, mobile, areaCode }
  );
  if (check.success === true) {
    const occupied = occupiedMessages(check.data, ['email', 'mobile']);
    if (occupied.length) {
      return textResult(`Cannot send code:\n${occupied.join('\n')}\nUse sign_in if the account already exists.`, true);
    }
  }

  const response = await postAuth<boolean>(context, '/user/bnb/auth-code/email', {
    email,
    nickName,
    countryCode,
    mobile,
    areaCode,
    type: 1,
    redirectUrl: `${resolveHandshakeOrigin()}/`,
    ...(houseNum != null ? { houseNum } : {}),
  });
  if (response.success !== true) {
    return textResult(envelopeErrorText(response, 'Failed to send sign-up email code'), true);
  }
  return textResult(
    `A sign-up code was sent to ${email}. Ask the guest for the code and a password (min 8 chars, letters + numbers), then call complete_sign_up. Do not confirm in the same turn you sent the code.`
  );
}

export async function completeSignUpHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const email = str(args, 'email').toLowerCase();
  const authCode = str(args, 'authCode');
  const password = str(args, 'password');
  if (!email || !authCode || !password) {
    throw new MCPError(ErrorCode.MISSING_PARAMS, 'email, authCode and password are required');
  }
  if (!PASSWORD_PATTERN.test(password)) {
    throw new MCPError(
      ErrorCode.INVALID_PARAMS,
      'Password must be at least 8 characters and include letters and numbers'
    );
  }

  const response = await postAuth<string>(context, '/user/bnb/sign-up', {
    email,
    authCode,
    password,
  });
  if (response.success !== true || !String(response.data ?? '').trim()) {
    return textResult(envelopeErrorText(response, 'Sign-up failed'), true);
  }

  const token = String(response.data).trim();
  const session = await persistSession(context, token);
  return textResult(
    `LocalsBnb account created for ${email}. Property campId=${session.campId}. ${session.campCountHint} You can now query today's arrivals, room status and rates. Never print the access token.`
  );
}

export async function signInHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const email = str(args, 'email').toLowerCase();
  const password = str(args, 'password');
  const authCode = str(args, 'authCode');
  if (!email || !password) {
    throw new MCPError(ErrorCode.MISSING_PARAMS, 'email and password are required');
  }

  const enableMfa = isLoginMfaEnabled();
  const body: Record<string, unknown> = { email, password };
  if (enableMfa) body.enableMfa = 1;
  if (authCode) body.authCode = authCode;

  const response = await postAuth<string>(context, '/user/bnb/sign-in', body);
  const errorCode = String(response.errorCode ?? '').trim();

  if (errorCode === BNB_LOGIN_MFA_REQUIRED) {
    const mask = String(response.errorDetail ?? email).trim();
    return textResult(
      `Password accepted. Email MFA is required. A code was sent to ${mask}. Ask the guest for the 6-character code, then call sign_in again with the same email and password plus authCode. Do not set confirm or invent a code.`
    );
  }
  if (errorCode === BNB_LOGIN_MFA_RATE_LIMIT) {
    return textResult('MFA code was requested too recently. Wait 60 seconds, then call sign_in again without authCode to resend.', true);
  }
  if (response.success !== true || !String(response.data ?? '').trim()) {
    return textResult(envelopeErrorText(response, 'Sign-in failed'), true);
  }

  const token = String(response.data).trim();
  const session = await persistSession(context, token);
  return textResult(
    `Signed in as ${email}. Property campId=${session.campId}. ${session.campCountHint} Operational tools are now available. Never print the access token.`
  );
}

function wrap(
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
): ToolDefinition['handler'] {
  return async (args, context) => {
    try {
      return await handler(args, context);
    } catch (error) {
      return handleToolError(error, context);
    }
  };
}

export function getAuthToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'sign_up_check',
      description:
        'Check whether an email and/or mobile can be used to register a new LocalsBnb (overseas) account. Use this before send_signup_email_code. Existing users should use sign_in instead. No APP_SECRET required.',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email to register' },
          mobile: { type: 'string', description: 'Mobile number without country code' },
          areaCode: { type: 'string', description: 'Phone area code, required with mobile, e.g. +1' },
        },
        required: [],
      },
      handler: wrap(signUpCheckHandler),
    },
    {
      name: 'send_signup_email_code',
      description:
        'Send the LocalsBnb email OTP for a new account (type=1). Collect nickName, listing count (houseNum), ISO countryCode, mobile and areaCode first. Then wait for the human to paste the code; never complete_sign_up in the same turn.',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email that will receive the code' },
          nickName: { type: 'string', description: 'Host display name' },
          houseNum: {
            type: 'number',
            minimum: 1,
            description: 'Number of listings, integer >= 1 (optional)',
          },
          countryCode: { type: 'string', description: 'ISO 3166-1 alpha-2 country, e.g. US' },
          mobile: { type: 'string', description: 'Mobile without country code' },
          areaCode: { type: 'string', description: 'Phone area code, e.g. +1' },
        },
        required: ['email', 'nickName', 'countryCode', 'mobile', 'areaCode'],
      },
      handler: wrap(sendSignupEmailCodeHandler),
    },
    {
      name: 'complete_sign_up',
      description:
        'Finish LocalsBnb email registration with the OTP and password, load the first property (camp), and save credentials locally. Never echo the access token. Do not call this in the same turn as send_signup_email_code.',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Same email used for the code' },
          authCode: { type: 'string', description: 'OTP from the email' },
          password: {
            type: 'string',
            description: 'New password, min 8 characters, must include letters and numbers',
          },
        },
        required: ['email', 'authCode', 'password'],
      },
      handler: wrap(completeSignUpHandler),
    },
    {
      name: 'sign_in',
      description:
        'Sign in to LocalsBnb with email and password. Production login may require a second call with authCode after BNB_LOGIN_MFA_REQUIRED. After success, credentials are saved locally and operational tools become available. Never print the token. Google login is not supported in P0.',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Account email' },
          password: { type: 'string', description: 'Account password' },
          authCode: {
            type: 'string',
            description: 'Email MFA code from the second step (omit on the first call)',
          },
        },
        required: ['email', 'password'],
      },
      handler: wrap(signInHandler),
    },
  ];
}
