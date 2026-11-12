import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler';
import { AUTH_ISSUER } from '@/lib/mcp/auth';

/** RFC 9728 metadata for the Claude connector at /mcp: sign in with Supabase Auth. */
const handler = protectedResourceHandler({ authServerUrls: [AUTH_ISSUER] });
const options = metadataCorsOptionsRequestHandler();

export { handler as GET, options as OPTIONS };
