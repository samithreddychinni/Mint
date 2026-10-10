"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export type Profile = {
  name: string;
  phone: string | null;
  completed_at: string | null;
};

export function ProfileForm({
  profile,
  onboarding = false,
  disabled,
  save,
}: {
  profile: Profile;
  onboarding?: boolean;
  disabled: boolean;
  save: (input: { name: string; phone: string }) => Promise<void>;
}) {
  const [name, setName] = useState(onboarding ? "" : profile.name);
  const [phone, setPhone] = useState(profile.phone || "");
  const changed = name.trim() !== profile.name || phone !== profile.phone;
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save({ name: name.trim(), phone });
      }}
    >
      <label className="field">
        Your name
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          minLength={2}
          maxLength={80}
          required
          disabled={disabled}
        />
      </label>
      <label className="field">
        Mobile number
        <Input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          autoComplete="tel"
          placeholder="10-digit mobile number"
          minLength={10}
          maxLength={30}
          required
          disabled={disabled}
        />
      </label>
      <p className="help-text">
        Your university email remains your sign-in. Your mobile number stays
        private and is not verified by SMS.
      </p>
      <Button disabled={disabled || (!onboarding && !changed)}>
        {onboarding ? "Continue to MINT" : "Save profile"}
      </Button>
    </form>
  );
}
