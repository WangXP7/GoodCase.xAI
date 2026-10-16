"""仅供课前构造与核验数据；不属于 submission.py，不上传到考场函数区。"""
from pathlib import Path
from itertools import product
import json
import random

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = {"(()(()()))", "((())())()", "())(()())(", "((()())())("}

def valid_balance(s):
    balance = 0
    for ch in s:
        balance += 1 if ch == "(" else -1
        if balance < 0:
            return False
    return balance == 0

def valid_reduce(s):
    while "()" in s:
        s = s.replace("()", "")
    return s == ""

def category(s):
    b = 0
    low = 0
    for ch in s:
        b += 1 if ch == "(" else -1
        low = min(low, b)
    if low >= 0 and b == 0:
        return "YES"
    if len(s) % 2:
        return "odd"
    if b == 0:
        return "balanced_wrong_order"
    if low >= 0:
        return "unclosed"
    return "extra_close_or_mixed"

def build():
    rng = random.Random(20261016)
    pool = ["".join(p) for n in range(2, 13) for p in product("()", repeat=n)]
    assert len(pool) == 8188
    assert all(valid_balance(s) == valid_reduce(s) for s in pool)
    selected = []
    # 50 positive examples; all small positives, plus structured and diverse long ones.
    for n, quota in [(2,1),(4,2),(6,5),(8,12),(10,14),(12,16)]:
        candidates = [s for s in pool if len(s) == n and valid_balance(s) and s not in PUBLIC]
        preferred = ["()"*(n//2), "("*(n//2)+")"*(n//2)]
        chosen = []
        for s in preferred:
            if s in candidates and s not in chosen:
                chosen.append(s)
        rng.shuffle(candidates)
        chosen += [s for s in candidates if s not in chosen][:quota-len(chosen)]
        selected.extend(chosen)
    # 50 negatives with explicit coverage, sampled round-robin across lengths.
    for kind, quota in [("balanced_wrong_order",20),("unclosed",10),
                        ("extra_close_or_mixed",10),("odd",10)]:
        buckets = {}
        for s in pool:
            if s not in PUBLIC and category(s) == kind:
                buckets.setdefault(len(s), []).append(s)
        for values in buckets.values():
            rng.shuffle(values)
        count = 0
        while count < quota:
            for length in sorted(buckets):
                if buckets[length] and count < quota:
                    selected.append(buckets[length].pop())
                    count += 1
    rng.shuffle(selected)
    assert len(selected) == len(set(selected)) == 100
    assert not PUBLIC.intersection(selected)
    rows = [{"sequence":s,"valid":"YES" if valid_balance(s) else "NO"} for s in selected]
    path = ROOT / "q2" / "train.jsonl"
    path.write_text("".join(json.dumps(r,ensure_ascii=False)+"\n" for r in rows),encoding="utf-8")
    return rows

if __name__ == "__main__":
    rows = build()
    print(json.dumps({"rows":len(rows),"YES":sum(r["valid"]=="YES" for r in rows),
                      "NO":sum(r["valid"]=="NO" for r in rows)},ensure_ascii=False))
