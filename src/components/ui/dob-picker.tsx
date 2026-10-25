import * as React from "react";
import { ChevronDown } from "lucide-react";
import { MONTH_NAMES, clampDayForMonth, buildIsoDate } from "@/lib/dob";
import { cn } from "@/lib/utils";

export interface DobPickerProps {
  value: string; // ISO date "YYYY-MM-DD" or ""
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  minAge?: number; // default 21
  maxAge?: number; // default 75
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

export function DobPicker({
  value,
  onChange,
  id,
  name,
  required,
  disabled,
  className,
  minAge = 21,
  maxAge = 75,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: DobPickerProps) {
  // Parse initial parts from ISO string
  const parseParts = React.useCallback((val: string) => {
    if (!val) return { y: "", m: "", d: "" };
    const parts = val.split("-");
    if (parts.length === 3) {
      return { y: parts[0] ?? "", m: parts[1] ?? "", d: parts[2] ?? "" };
    }
    return { y: "", m: "", d: "" };
  }, []);

  const [day, setDay] = React.useState<string>(() => parseParts(value).d);
  const [month, setMonth] = React.useState<string>(() => parseParts(value).m);
  const [year, setYear] = React.useState<string>(() => parseParts(value).y);

  // Track the last value emitted by this component so internal state is not wiped
  const lastEmittedValueRef = React.useRef<string>(value);

  // Synchronize internal state ONLY when value changes from an external source
  React.useEffect(() => {
    if (value !== lastEmittedValueRef.current) {
      lastEmittedValueRef.current = value;
      const { y, m, d } = parseParts(value);
      setYear(y);
      setMonth(m);
      setDay(d);
    }
  }, [value, parseParts]);

  const currentCalYear = new Date().getFullYear();
  const maxBirthYear = currentCalYear - minAge;
  const minBirthYear = currentCalYear - maxAge;

  const years = React.useMemo(() => {
    const list: string[] = [];
    for (let y = maxBirthYear; y >= minBirthYear; y--) {
      list.push(String(y));
    }
    return list;
  }, [maxBirthYear, minBirthYear]);

  const days = React.useMemo(() => {
    const list: string[] = [];
    for (let d = 1; d <= 31; d++) {
      list.push(String(d).padStart(2, "0"));
    }
    return list;
  }, []);

  const updateDate = (newDay: string, newMonth: string, newYear: string) => {
    let validDay = newDay;
    if (validDay && newMonth) {
      const y = newYear ? parseInt(newYear, 10) : 2024;
      const m = parseInt(newMonth, 10);
      const clamped = clampDayForMonth(parseInt(validDay, 10), m, y);
      validDay = String(clamped).padStart(2, "0");
    }

    setDay(validDay);
    setMonth(newMonth);
    setYear(newYear);

    const iso = buildIsoDate(validDay, newMonth, newYear);
    lastEmittedValueRef.current = iso;
    onChange(iso);
  };

  const isInvalid = ariaInvalid === true || ariaInvalid === "true";

  return (
    <div className={cn("grid w-full max-w-[280px] grid-cols-3 gap-2", className)}>
      <div className="relative">
        <select
          id={id}
          value={day}
          onChange={(e) => updateDate(e.target.value, month, year)}
          disabled={disabled}
          aria-label="Day of birth"
          aria-invalid={isInvalid}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "flex h-9 w-full cursor-pointer appearance-none rounded-md border border-input bg-transparent px-2.5 py-1 pr-6 text-sm shadow-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            isInvalid && "border-destructive focus-visible:ring-destructive",
          )}
        >
          <option value="" disabled className="bg-popover text-muted-foreground">
            Day
          </option>
          {days.map((d) => (
            <option key={d} value={d} className="bg-popover text-popover-foreground">
              {parseInt(d, 10)}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>

      <div className="relative">
        <select
          id={id ? `${id}-month` : undefined}
          value={month}
          onChange={(e) => updateDate(day, e.target.value, year)}
          disabled={disabled}
          aria-label="Month of birth"
          aria-invalid={isInvalid}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "flex h-9 w-full cursor-pointer appearance-none rounded-md border border-input bg-transparent px-2.5 py-1 pr-6 text-sm shadow-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            isInvalid && "border-destructive focus-visible:ring-destructive",
          )}
        >
          <option value="" disabled className="bg-popover text-muted-foreground">
            Month
          </option>
          {MONTH_NAMES.map((m) => (
            <option key={m.value} value={m.value} className="bg-popover text-popover-foreground">
              {m.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>

      <div className="relative">
        <select
          id={id ? `${id}-year` : undefined}
          value={year}
          onChange={(e) => updateDate(day, month, e.target.value)}
          disabled={disabled}
          aria-label="Year of birth"
          aria-invalid={isInvalid}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "flex h-9 w-full cursor-pointer appearance-none rounded-md border border-input bg-transparent px-2.5 py-1 pr-6 text-sm shadow-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            isInvalid && "border-destructive focus-visible:ring-destructive",
          )}
        >
          <option value="" disabled className="bg-popover text-muted-foreground">
            Year
          </option>
          {years.map((y) => (
            <option key={y} value={y} className="bg-popover text-popover-foreground">
              {y}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>

      {name && (
        <input
          type="hidden"
          name={name}
          value={value}
          required={required}
          aria-invalid={isInvalid}
        />
      )}
    </div>
  );
}
