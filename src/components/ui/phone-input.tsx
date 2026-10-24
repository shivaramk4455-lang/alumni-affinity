import * as React from "react";
import { ChevronDown } from "lucide-react";
import {
  COUNTRY_DIAL_CODES,
  getDialCodeNumeric,
  parsePhoneNumber,
  type CountryDialCode,
} from "@/lib/country-codes";
import { cn } from "@/lib/utils";

const DEFAULT_COUNTRY: CountryDialCode = COUNTRY_DIAL_CODES[0] ?? {
  country: "India",
  code: "+91",
  flag: "🇮🇳",
  placeholder: "98765 43210",
};

export interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
  autoComplete?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

export function PhoneInput({
  value,
  onChange,
  id,
  name,
  required,
  disabled,
  readOnly,
  className,
  placeholder,
  autoComplete = "tel-national",
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: PhoneInputProps) {
  const parsed = React.useMemo(() => parsePhoneNumber(value), [value]);
  const [selectedCode, setSelectedCode] = React.useState<string>(parsed.countryCode);

  // Synchronize country selection if value changes from outside with a different dial code
  React.useEffect(() => {
    if (parsed.countryCode && parsed.countryCode !== selectedCode) {
      setSelectedCode(parsed.countryCode);
    }
  }, [parsed.countryCode, selectedCode]);

  const activeCountry = COUNTRY_DIAL_CODES.find((c) => c.code === selectedCode) ?? DEFAULT_COUNTRY;

  const handleCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCode = e.target.value;
    setSelectedCode(newCode);
    const numCode = getDialCodeNumeric(newCode);
    if (parsed.localNumber) {
      onChange(`${numCode} ${parsed.localNumber}`);
    } else {
      onChange("");
    }
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawInput = e.target.value;

    // If pasted an international format starting with '+'
    if (rawInput.trim().startsWith("+")) {
      const p = parsePhoneNumber(rawInput);
      setSelectedCode(p.countryCode);
      const numCode = getDialCodeNumeric(p.countryCode);
      onChange(p.localNumber ? `${numCode} ${p.localNumber}` : "");
      return;
    }

    const sanitized = rawInput.replace(/[^\d\s\-()]/g, "");
    if (!sanitized.trim()) {
      onChange("");
      return;
    }

    const numCode = getDialCodeNumeric(selectedCode);
    onChange(`${numCode} ${sanitized.trimStart()}`);
  };

  const isInvalid = ariaInvalid === true || ariaInvalid === "true";

  return (
    <div
      className={cn(
        "relative flex h-9 w-full rounded-md border border-input bg-transparent shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring",
        isInvalid && "border-destructive focus-within:ring-destructive",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <div className="relative flex shrink-0 items-center rounded-l-md border-r border-input bg-muted/20 px-2.5 transition-colors hover:bg-muted/40 focus-within:z-10 focus-within:ring-1 focus-within:ring-ring">
        <span className="text-base leading-none" aria-hidden="true">
          {activeCountry.flag}
        </span>
        <span className="ml-1.5 text-xs font-semibold tabular-nums text-foreground">
          {getDialCodeNumeric(activeCountry.code)}
        </span>
        <ChevronDown className="ml-1 size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <select
          aria-label="Country calling code"
          value={selectedCode}
          onChange={handleCountryChange}
          disabled={disabled || readOnly}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus:outline-none disabled:cursor-not-allowed"
        >
          {COUNTRY_DIAL_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.country} ({getDialCodeNumeric(c.code)})
            </option>
          ))}
        </select>
      </div>
      <input
        type="tel"
        inputMode="tel"
        id={id}
        name={name}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        value={parsed.localNumber}
        placeholder={placeholder ?? activeCountry.placeholder}
        autoComplete={autoComplete}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        onChange={handleNumberChange}
        className="flex-1 min-w-0 bg-transparent px-3 py-1 text-base placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed md:text-sm"
      />
    </div>
  );
}
