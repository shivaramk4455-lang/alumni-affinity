export type Form = {
  full_name: string;
  created_by: string;
  gender: string;
  birth_year: string;
  city: string;
  height_cm: string;
  marital_status: string;
  diet: string;
  mother_tongue: string;
  residency_status: string;
  religion: string;
  caste: string;
  gotra: string;
  birth_time: string;
  birth_place: string;
  rashi: string;
  nakshatra: string;
  nakshatra_pada: string;
  manglik: string;
  institution: string;
  degree: string;
  grad_year: string;
  profession: string;
  employer: string;
  relocation: string;
  values_statement: string;
  bio: string;
  is_visible: boolean;
  pref_min_age: string;
  pref_max_age: string;
  pref_min_height: string;
  pref_max_height: string;
  pref_marital_status: string;
  pref_diet: string;
  pref_relocation: string;
};

export type SetFormField = (k: keyof Form, v: string | boolean) => void;

export const emptyForm: Form = {
  full_name: "",
  created_by: "Self",
  gender: "",
  birth_year: "",
  city: "",
  height_cm: "",
  marital_status: "",
  diet: "",
  mother_tongue: "",
  residency_status: "",
  religion: "",
  caste: "",
  gotra: "",
  birth_time: "",
  birth_place: "",
  rashi: "",
  nakshatra: "",
  nakshatra_pada: "",
  manglik: "",
  institution: "",
  degree: "",
  grad_year: "",
  profession: "",
  employer: "",
  relocation: "",
  values_statement: "",
  bio: "",
  is_visible: true,
  pref_min_age: "",
  pref_max_age: "",
  pref_min_height: "",
  pref_max_height: "",
  pref_marital_status: "",
  pref_diet: "",
  pref_relocation: "",
};
