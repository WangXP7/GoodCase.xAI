import { calculateGoldAllowance, reduceGoldLedger, createGoldLedgerEvent, applyIslandTax, DEFAULT_ECONOMY_POLICY } from '../packages/tinyworld-mmo-core/src/index.js';

console.log("=== TinyWorld MMO Workflow Loop Verification ===");

const policy = DEFAULT_ECONOMY_POLICY;
console.log("Policy maxTax:", policy.maxTaxRate);

// 1. Tax cap
const split = applyIslandTax({grossAmount:100, minerWallet:"m", resource:"ore"}, {taxRate:0.75, ownerWallet:"o"}, policy);
console.log("Tax cap 20% test:", split.taxRate === 0.2 ? "PASS" : "FAIL", split.taxRate);

// 2. GOLD calc
const gold = calculateGoldAllowance({tinyworldHeld:"10000", islandCount:1, spentThisCycle:50});
console.log("GOLD calc available:", gold.available, "PASS if >0");

// 3. Ledger roundtrip
const ev1 = createGoldLedgerEvent("ALLOWANCE_RECALCULATED", {wallet:"p1", cycleId:"w1", amount:500});
const ev2 = createGoldLedgerEvent("GOLD_SPENT", {wallet:"p1", cycleId:"w1", amount:120});
const summary = reduceGoldLedger([ev1, ev2], {wallet:"p1", cycleId:"w1"});
console.log("Ledger reduce available:", summary.available, "PASS if 380");

// 4. Accrual simulation
const harvestGold = createGoldLedgerEvent("ALLOWANCE_RECALCULATED", {wallet:"p1", amount:10, reason:"harvest"});
console.log("Harvest GOLD event created:", harvestGold.type);

console.log("=== Loop verification complete ===");
