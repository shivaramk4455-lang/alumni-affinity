declare module "@tanstack/react-start/server-entry" {
  const entry: {
    fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
  };
  export default entry;
}

declare module "@tanstack/react-start/server" {
  export const defaultStreamHandler: unknown;
  export function getRequest(): Request;
}
