import { Button } from "@/components/ui/button";
import type { PlanContact } from "@/lib/matching/plan-resources";

/** Keep unresolved historical contacts visible until the case manager removes or replaces them. */
export function PlanContactPicker({ value, choices, onChange, disabled = false }: {
  value: PlanContact[];
  choices: PlanContact[];
  onChange: (value: PlanContact[]) => void;
  disabled?: boolean;
}) {
  const current = (contact: PlanContact) => choices.find(choice =>
    contact.source_resource_id && choice.source_resource_id === contact.source_resource_id &&
    choice.source_updated_at === contact.source_updated_at);
  return (
    <fieldset disabled={disabled} className="space-y-2 text-sm">
      <legend className="font-medium">Directory contacts</legend>
      <p className="text-xs text-[var(--color-ink-muted)]">Select matched programs. Confirm current availability, eligibility, and contact details before referring.</p>
      {value.filter(contact => !current(contact)).map((contact, index) => (
        <div key={`${contact.source_resource_id ?? "legacy"}-${index}`} className="rounded border border-[var(--color-rule)] p-2">
          <p>{contact.name || "Previous contact"}: needs a current directory source. Remove this contact, then select its updated entry if available.</p>
          <Button type="button" variant="secondary" onClick={() => onChange(value.filter(item => item !== contact))}>Remove {contact.name || "previous contact"}</Button>
        </div>
      ))}
      {choices.length === 0 && <p>No available matched programs. You can leave contacts empty or update the family’s resource matches.</p>}
      {choices.map(choice => (
        <label key={choice.source_resource_id} className="flex items-start gap-2 rounded border border-[var(--color-rule)] p-2">
          <input type="checkbox" className="mt-1" checked={value.some(contact => current(contact) === choice)}
            onChange={event => onChange(event.target.checked
              ? [...value.filter(contact => contact.source_resource_id !== choice.source_resource_id), choice]
              : value.filter(contact => contact.source_resource_id !== choice.source_resource_id))} />
          <span>{choice.name}<span className="block text-xs text-[var(--color-ink-muted)]">{[choice.phone, choice.email].filter(Boolean).join(" · ") || "No phone or email supplied in the directory."}</span></span>
        </label>
      ))}
    </fieldset>
  );
}
