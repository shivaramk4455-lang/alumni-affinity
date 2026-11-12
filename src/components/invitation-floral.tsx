import floralCorner from "@/assets/invitation-floral-corner.png";

/** Restrained botanical detail inspired by Indian wedding invitation borders. */
export function InvitationFloral({ className = "" }: { className?: string }) {
  return (
    <img
      src={floralCorner}
      alt=""
      aria-hidden="true"
      width={1024}
      height={768}
      loading="eager"
      className={`pointer-events-none select-none object-contain ${className}`}
    />
  );
}