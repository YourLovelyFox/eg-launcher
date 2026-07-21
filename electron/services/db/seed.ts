/** Seeding is done via scripts/init-cms-db.mjs or the CMS API — not from the Electron client. */
export async function seedCmsIfEmpty(): Promise<{ seeded: string[] }> {
  return { seeded: [] }
}
