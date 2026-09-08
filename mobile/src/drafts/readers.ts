export type DraftReader = { id: string; name: string };

/** Deliberately separate from Person DTOs and from privileged account records. */
export function parseDraftReaders(value: unknown): DraftReader[] {
  const invalid = () => { throw new Error("无法读取可选成员，请联网重试。已选读者仍保留。"); };
  if (!value || typeof value !== "object" || !("members" in value) || !Array.isArray(value.members)) return invalid();
  const members = value.members.map((member: unknown) => {
    if (!member || typeof member !== "object" || !("id" in member) || !("name" in member) ||
        typeof member.id !== "string" || !/^[\w-]{1,128}$/u.test(member.id) ||
        typeof member.name !== "string" || member.name.length > 1000) return invalid();
    return { id: member.id, name: member.name };
  });
  if (new Set(members.map(member => member.id)).size !== members.length) return invalid();
  return members;
}
