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
  const [day, setDay] = React.useState<string>(() => {
    const parts = value ? value.split("-") : [];
    return parts.length === 3 && parts[2] ? parts[2] : "";
  });
  const [month, setMonth] = React.useState<string>(() => {
    const parts = value ? value.split("-") : [];
    return parts.length === 3 && parts[1] ? parts[1] : "";
  });
  const [year, setYear] = React.useState<string>(() => {
    const parts = value ? value.split("-") : [];
    return parts.length === 3 && parts[0] ? parts[0] : "";
  });

  // Keep state in sync if value is updated externally
  React.useEffect(() => {
    if (value) {
      const parts = value.split("-");
      if (parts.length === 3) {
        if (parts[0] && parts[0] !== year) setYear(parts[0]);
        if (parts[1] && parts[1] !== month) setMonth(parts[1]);
        if (parts[2] && parts[2] !== day) setDay(parts[2]);
      }
    } else {
      setDay("");
      setMonth("");
      setYear("");
    }
  }, [value, year, month, day]);

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
    onChange(iso);
  };

  const isInvalid = ariaInvalid === true || ariaInvalid === "true";

  return (
    <div className={cn("grid w-full max-w-[280px] grid-cols-3 gap-2", className)}>
      <div className="relative">
        <select
          id={id ? `${id}-day` : undefined}
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
