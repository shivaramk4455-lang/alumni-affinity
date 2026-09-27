/**
 * Notification rows carry a `link` that members can influence, so it must never
 * be fed straight into a router or an anchor. The database policy only accepts
 * these four destinations; this narrows an untrusted string to that set, which
 * also keeps `<Link to=...>` type-safe.
 */
export type NotificationDestination =
  "/connections" | "/copilots" | "/notifications" | "/dashboard";

export function notificationDestination(link: string | null | undefined): NotificationDestination {
  switch (link) {
    case "/connections":
    case "/copilots":
    case "/notifications":
    case "/dashboard":
      return link;
    default:
      return "/dashboard";
  }
}
