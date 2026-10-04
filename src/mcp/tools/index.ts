import type { RegisteredTool } from '../registry';
import { codeConnectTools } from './codeConnect';
import { generativeTools, platformTools, weaveTools } from './platform';
import { readTools } from './read';
import { writeTools } from './write';

/** Every tool the server exposes, in catalog order. */
export const allTools: RegisteredTool[] = [...readTools, ...writeTools, ...codeConnectTools, ...platformTools, ...generativeTools, ...weaveTools];
