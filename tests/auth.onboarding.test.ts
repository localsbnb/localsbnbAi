import type { ToolContext } from '../src/types/mcp';
import {
  completeSignUpHandler,
  sendSignupEmailCodeHandler,
  signInHandler,
  signUpCheckHandler,
} from '../src/tools/auth/onboarding';

function contextWith(
  request: jest.Mock,
  applyHudsonSession?: jest.Mock
): ToolContext {
  return {
    apiClient: {
      request,
      setHudsonAccessToken: jest.fn(),
    },
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    permissionChecker: { checkPermission: jest.fn() },
    applyHudsonSession: applyHudsonSession ?? jest.fn().mockResolvedValue(undefined),
  };
}

describe('auth onboarding tools', () => {
  it('sign_up_check reports occupied email', async () => {
    const request = jest.fn().mockResolvedValue({
      success: true,
      data: {
        errorMessages: [{ field: 'email', boolean: false, message: 'Email taken' }],
      },
    });
    const result = await signUpCheckHandler({ email: 'a@b.com' }, contextWith(request));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Email taken');
  });

  it('sign_up_check allows available email', async () => {
    const request = jest.fn().mockResolvedValue({
      success: true,
      data: { errorMessages: [{ field: 'email', boolean: true, message: 'ok' }] },
    });
    const result = await signUpCheckHandler({ email: 'a@b.com' }, contextWith(request));
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/available/i);
  });

  it('send_signup_email_code requires listing fields', async () => {
    const request = jest.fn();
    await expect(sendSignupEmailCodeHandler({ email: 'a@b.com' }, contextWith(request))).rejects.toMatchObject({
      code: 'MISSING_PARAMS',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('send_signup_email_code includes redirectUrl', async () => {
    const request = jest.fn().mockResolvedValue({ success: true, data: true });
    const result = await sendSignupEmailCodeHandler(
      {
        email: 'a@b.com',
        nickName: 'viclee',
        countryCode: 'US',
        mobile: '13928802039',
        areaCode: '+81',
        houseNum: 10,
      },
      contextWith(request)
    );
    expect(result.isError).toBeFalsy();
    const sendCall = request.mock.calls.find((call) => call[0].url === '/user/bnb/auth-code/email');
    expect(sendCall[0].data.redirectUrl).toMatch(/^https?:\/\/.+/);
    expect(sendCall[0].data.type).toBe(1);
  });

  it('complete_sign_up rejects weak passwords', async () => {
    const request = jest.fn();
    await expect(
      completeSignUpHandler({ email: 'a@b.com', authCode: 'ABC123', password: 'short' }, contextWith(request))
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('complete_sign_up persists App Secret from generate, not the login JWT', async () => {
    const apply = jest.fn().mockResolvedValue(undefined);
    const request = jest.fn().mockImplementation(async (cfg: { url: string; data?: { campId?: string } }) => {
      if (cfg.url === '/user/bnb/sign-up') {
        return { success: true, data: 'LOGIN_JWT' };
      }
      if (cfg.url === '/camps/get') {
        return { success: true, data: { camps: [{ campId: '9001', name: 'Beach' }] } };
      }
      if (cfg.url === '/user/secret/get') {
        return { success: true, data: '' };
      }
      if (cfg.url === '/user/secret/generate') {
        expect(cfg.data).toEqual({ campId: '9001' });
        return { success: true, data: 'APP_SECRET_LONG' };
      }
      throw new Error(cfg.url);
    });
    const result = await completeSignUpHandler(
      { email: 'a@b.com', authCode: 'ABC123', password: 'Passw0rd' },
      contextWith(request, apply)
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('9001');
    expect(result.content[0].text).not.toContain('LOGIN_JWT');
    expect(result.content[0].text).not.toContain('APP_SECRET_LONG');
    expect(apply).toHaveBeenCalledWith('APP_SECRET_LONG', '9001');
  });

  it('sign_in reuses existing App Secret from /user/secret/get', async () => {
    const apply = jest.fn().mockResolvedValue(undefined);
    const request = jest.fn().mockImplementation(async (cfg: { url: string }) => {
      if (cfg.url === '/user/bnb/sign-in') {
        return { success: true, data: 'LOGIN_JWT' };
      }
      if (cfg.url === '/camps/get') {
        return { success: true, data: { camps: [{ campId: '77' }] } };
      }
      if (cfg.url === '/user/secret/get') {
        return { success: true, data: 'EXISTING_APP_SECRET' };
      }
      throw new Error(cfg.url);
    });
    const result = await signInHandler(
      { email: 'a@b.com', password: 'Passw0rd', authCode: 'XY9K2M' },
      contextWith(request, apply)
    );
    expect(result.content[0].text).toContain('77');
    expect(apply).toHaveBeenCalledWith('EXISTING_APP_SECRET', '77');
    expect(request.mock.calls.some((call) => call[0].url === '/user/secret/generate')).toBe(false);
  });

  it('sign_in asks for MFA without treating it as a hard failure', async () => {
    const request = jest.fn().mockResolvedValue({
      success: false,
      errorCode: 'BNB_LOGIN_MFA_REQUIRED',
      errorDetail: 'a***@b.com',
    });
    const apply = jest.fn();
    const result = await signInHandler({ email: 'a@b.com', password: 'Passw0rd' }, contextWith(request, apply));
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('MFA');
    expect(result.content[0].text).toContain('a***@b.com');
    expect(apply).not.toHaveBeenCalled();
  });

});
