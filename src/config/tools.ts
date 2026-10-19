import type { ToolDefinition } from '../types/mcp.js';
import { getOverseasToolDescription, type RegionProfile } from '../region/index.js';
import { toolDefinitions, overseasWriteTools } from './businessTools.js';
export { toolDefinitions } from './businessTools.js';
import { getAuthToolDefinitions } from '../tools/auth/onboarding.js';
import { getHandshakeToolDefinitions } from '../tools/auth/handshake.js';
import { getOverseasOperationTools } from '../tools/overseas/operationTools.js';

export function getActiveToolDefinitions(profile: RegionProfile): ToolDefinition[] {
  const authTools = getAuthToolDefinitions();
  if (profile.region !== 'overseas') {
    return [...authTools, ...toolDefinitions];
  }
  const localized = toolDefinitions.map((tool) => {
    const description = getOverseasToolDescription(tool.name, profile.locale);
    return description ? { ...tool, description } : tool;
  });
  return [...authTools, ...localized, ...overseasWriteTools(profile), ...getHandshakeToolDefinitions(), ...getOverseasOperationTools()];
}
