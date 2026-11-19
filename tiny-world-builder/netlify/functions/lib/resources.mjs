// E5 — resource → Earned GOLD conversion. Pure, server-authoritative rates so the
// client can never set its own price (it only names amounts to sell). Rates reflect
// relative scarcity/value of each harvested resource.
export const SELLABLE_RESOURCES = Object.freeze(['fish', 'meat', 'plants', 'ore']);

export const RESOURCE_GOLD_RATES = Object.freeze({
  plants: 1,
  fish: 1,
  meat: 2,
  ore: 3,
});

export function isSellableResource(type) {
  return SELLABLE_RESOURCES.includes(String(type || ''));
}

// Normalize a {fish,meat,plants,ore} amounts map to non-negative safe integers,
// ignoring unknown keys. Returns { amounts, totalUnits, gold }.
export function computeResourceSale(rawAmounts) {
  const amounts = { fish: 0, meat: 0, plants: 0, ore: 0 };
  let totalUnits = 0;
  let gold = 0;
  for (const type of SELLABLE_RESOURCES) {
    const n = Number(rawAmounts && rawAmounts[type]);
    if (!Number.isFinite(n) || n <= 0) continue;
    const units = Math.floor(n);
    if (units <= 0 || units > 1_000_000_000) continue; // bound a single sale
    amounts[type] = units;
    totalUnits += units;
    gold += units * RESOURCE_GOLD_RATES[type];
  }
  return { amounts, totalUnits, gold };
}
