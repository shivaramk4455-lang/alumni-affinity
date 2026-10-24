import { cloneElement, isValidElement, useId } from "react";
import { CircleAlert } from "lucide-react";

import { Label } from "@/components/ui/label";

export function FormField({
  label,
  children,
  error,
  note,
}: {
  label: string;
  children: React.ReactNode;
  // `| undefined` because project sets exactOptionalPropertyTypes.
  error?: string | undefined;
  note?: string | undefined;
}) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(
        children as React.ReactElement<{
          id?: string;
          "aria-invalid"?: boolean | undefined;
          "aria-describedby"?: string | undefined;
        }>,
        {
          id,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": error ? `${id}-error` : undefined,
        },
      )
    : children;
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {note && <span className="text-xs text-brass font-medium">{note}</span>}
      </div>
      {control}
      {error && (
        <span
          id={`${id}-error`}
          role="alert"
          className="flex items-start gap-1.5 text-sm leading-6 text-destructive"
        >
          <CircleAlert className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  );
}
