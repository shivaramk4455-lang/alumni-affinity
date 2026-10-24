import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import { CircleAlert } from "lucide-react";

/**
 * Inline validation message with accessible role="alert".
 */
export function FieldError({ text, id }: { text: string; id?: string }) {
  return (
    <span
      id={id}
      role="alert"
      className="flex items-start gap-1.5 text-sm leading-6 text-destructive"
    >
      <CircleAlert className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
      {text}
    </span>
  );
}

/**
 * A form field: label text, one control, an optional hint and an optional
 * inline error with full accessible id and aria-describedby linkage.
 */
export function FormField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const errId = `${id}-error`;
  const hintId = `${id}-hint`;

  const items = Children.toArray(children);
  const errorNode = items.find((c) => isValidElement(c) && c.type === FieldError);
  const control = items.find((c) => !(isValidElement(c) && c.type === FieldError));
  const hasError = Boolean(errorNode);

  const describedBy = [hint ? hintId : null, hasError ? errId : null].filter(Boolean).join(" ");

  const wired = isValidElement(control)
    ? cloneElement(control as ReactElement<Record<string, unknown>>, {
        id,
        "aria-invalid": hasError ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })
    : control;

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        {label}
      </label>
      {wired}
      {hint && (
        <span id={hintId} className="text-sm font-normal leading-6 text-muted-foreground">
          {hint}
        </span>
      )}
      {isValidElement(errorNode)
        ? cloneElement(errorNode as ReactElement<Record<string, unknown>>, { id: errId })
        : null}
    </div>
  );
}

export function ApplyStepContainer({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="font-serif text-3xl font-semibold md:text-4xl text-foreground">{title}</h2>
      <p className="mt-2 mb-8 text-sm leading-6 text-muted-foreground">{note}</p>
      {children}
    </section>
  );
}
