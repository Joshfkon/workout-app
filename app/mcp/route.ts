import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { verifyToken } from '@/lib/mcp/auth';
import { registerTools } from '@/lib/mcp/tools';

// The Claude connector: add https://www.hypertrack.app/mcp as a custom
// connector in Claude. Claude signs in through Supabase Auth (see
// /oauth/consent) and every tool runs as that user, read-only.
const handler = createMcpHandler(registerTools, {
  serverInfo: { name: 'HyperTrack', version: '1.0.0' },
  instructions:
    "HyperTrack is the user's hypertrophy training log: workouts with every set, the active mesocycle and schedule, weekly volume per muscle, nutrition, body weight, body composition, steps and sleep. Start with profile_overview for general questions. All tools are read-only. Weights are shown in the user's preferred unit; effort is reps in reserve (RIR). Pass the user's IANA time zone to tools that accept it so 'today' matches their calendar. This is training data, not medical advice.",
});

const authed = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
});

export { authed as GET, authed as POST, authed as DELETE };
export const maxDuration = 60;
