export interface CountryDialCode {
  country: string;
  code: string;
  flag: string;
  placeholder: string;
}

export const COUNTRY_DIAL_CODES: readonly CountryDialCode[] = [
  { country: "India", code: "+91", flag: "🇮🇳", placeholder: "98765 43210" },
  { country: "United States", code: "+1", flag: "🇺🇸", placeholder: "(555) 012-3456" },
  { country: "United Kingdom", code: "+44", flag: "🇬🇧", placeholder: "7911 123456" },
  { country: "United Arab Emirates", code: "+971", flag: "🇦🇪", placeholder: "50 123 4567" },
  { country: "Canada", code: "+1-CA", flag: "🇨🇦", placeholder: "(555) 012-3456" },
  { country: "Singapore", code: "+65", flag: "🇸🇬", placeholder: "8123 4567" },
  { country: "Australia", code: "+61", flag: "🇦🇺", placeholder: "412 345 678" },
  { country: "Germany", code: "+49", flag: "🇩🇪", placeholder: "151 23456789" },
  { country: "Netherlands", code: "+31", flag: "🇳🇱", placeholder: "6 12345678" },
  { country: "Switzerland", code: "+41", flag: "🇨🇭", placeholder: "78 123 45 67" },
  { country: "Saudi Arabia", code: "+966", flag: "🇸🇦", placeholder: "50 123 4567" },
  { country: "Qatar", code: "+974", flag: "🇶🇦", placeholder: "3312 3456" },
  { country: "Kuwait", code: "+965", flag: "🇰🇼", placeholder: "5123 4567" },
  { country: "Oman", code: "+968", flag: "🇴🇲", placeholder: "9123 4567" },
  { country: "Bahrain", code: "+973", flag: "🇧🇭", placeholder: "3612 3456" },
  { country: "Ireland", code: "+353", flag: "🇮🇪", placeholder: "85 123 4567" },
  { country: "France", code: "+33", flag: "🇫🇷", placeholder: "6 12 34 56 78" },
  { country: "Sweden", code: "+46", flag: "🇸🇪", placeholder: "70 123 45 67" },
  { country: "New Zealand", code: "+64", flag: "🇳🇿", placeholder: "21 123 4567" },
  { country: "Hong Kong", code: "+852", flag: "🇭🇰", placeholder: "9123 4567" },
  { country: "Japan", code: "+81", flag: "🇯🇵", placeholder: "90 1234 5678" },
  { country: "Malaysia", code: "+60", flag: "🇲🇾", placeholder: "12 345 6789" },
  { country: "South Africa", code: "+27", flag: "🇿🇦", placeholder: "71 123 4567" },
] as const;

export function getDialCodeNumeric(code: string): string {
  if (code === "+1-CA") return "+1";
  return code;
}

/**
 * Parses an existing full phone string into a selected country code and local number.
 */
export function parsePhoneNumber(raw: string | null | undefined): {
  countryCode: string;
  localNumber: string;
} {
  if (!raw || !raw.trim()) {
    return { countryCode: "+91", localNumber: "" };
  }
  const clean = raw.trim();

  // If the string starts with a plus, find the longest matching dial code
  if (clean.startsWith("+")) {
    const candidates = [...COUNTRY_DIAL_CODES].sort(
      (a, b) => getDialCodeNumeric(b.code).length - getDialCodeNumeric(a.code).length,
    );
    for (const c of candidates) {
      const numCode = getDialCodeNumeric(c.code);
      if (clean.startsWith(numCode)) {
        const remaining = clean.slice(numCode.length).trim();
        return { countryCode: c.code, localNumber: remaining };
      }
    }
  }

  // If already starts with 91 followed by space or 10 digits
  if (/^91\d{10}$/.test(clean.replace(/\s+/g, ""))) {
    return { countryCode: "+91", localNumber: clean.replace(/^91/, "").trim() };
  }

  return { countryCode: "+91", localNumber: clean };
}
