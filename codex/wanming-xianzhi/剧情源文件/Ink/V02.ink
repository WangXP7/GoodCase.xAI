VAR choice_id = ""
VAR m01 = 0
VAR v01 = 0
VAR a01 = 0
VAR v02 = 0
VAR a02 = 0
VAR r01 = 0
VAR m02 = 0
VAR m03 = 0
VAR v03 = 0
VAR a03 = 0
VAR a04 = 0
VAR v04 = 0
VAR r02 = 0
VAR m04 = 0
VAR m05 = 0
VAR v05 = 0
VAR a05 = 0
VAR a06 = 0
VAR r03 = 0
VAR m06 = 0
VAR m07 = 0
VAR v06 = 0
VAR a07 = 0
VAR a08 = 0
VAR r04 = 0
VAR m08 = 0
VAR m09 = 0
VAR v07 = 0
VAR a09 = 0
VAR r05 = 0
VAR r06 = 0
VAR m10 = 0
VAR m11 = 0
VAR v08 = 0
VAR a10 = 0
VAR r07 = 0
VAR r08 = 0
VAR m12 = 0
VAR silver = 0
VAR grain = 0
VAR welfare = 0
VAR order = 0
VAR works = 0
VAR trust = 0
VAR standing = 0
VAR integrity = 0
VAR proof = 0
VAR shadow = 0
VAR rel_shen = 0
VAR rel_lu = 0
VAR rel_he = 0
VAR rel_wei = 0
VAR rel_sang = 0
VAR rel_xu = 0
VAR rel_cheng = 0
VAR rel_luo = 0
VAR has_ledger = 0
VAR has_boats = 0
VAR has_receipt = 0
VAR has_white = 0
VAR has_survey = 0
VAR has_clinic = 0
VAR has_pact = 0
陆青禾进衙门，先把鞋底的河泥刮净。她没带贺礼，将一把绳尺放在桌上，说这东西借给县里用过一年，如今想讨回来。绳结已经磨得发亮，末端缺了一小截。
东堤上季工钱拖了七个月。名册上是二十六人，她另列了五个：两人半途伤病，三人接替家中老人，算工时被并在父辈名下。你问为何此前不来，她说前任准过三次，每次准得很有道理，冬粮急，解银急，新年又要清账。她怕再来一次，大家会觉得是她把钱私吞了。
图上东堤像一道细线。陆青禾用尺压住一个转弯：“这里下头是沙，去年只换了表皮。修堤的若连饭钱也没拿到，今年你叫他往水里探脚，他会先想着岸上有没有人替他讨账。”她没说工人一定不来，正因为有些人仍会来，事情才更难办。
她父亲曾在旧堤下落水。名册写病故，家里一直收着那张纸，免得母亲再领不到最后一笔工钱。她提起父亲时，声音并没变，只把绳尺缺的那端往掌心收了收。
陆青禾只请你说定第一笔何时、由谁、在何处交到工人手上。
* {silver >= 12} [先付旧工钱，换一张逐段验工表]
~ choice_id = "a"
你拨出旧工钱，逐人领取，不让工头代领全部。陆青禾把五个漏名者叫来，先解释各自该算多少。验工表由她写，修过与未修分成两栏。领到钱的人没有齐声道谢，有人先去买米，有人算着欠药铺的债。绳尺留下了，作为公家借用的物件，另开收条，不再算她的无偿报效。
-> END
* {silver >= 5} [约定分期，先修最险的四十丈]
~ choice_id = "b"
你把分期写成两张可带走的凭条，第一笔先付，余款约在下一季清点后。陆青禾要求验工也分段，不许完了一段又拿全堤未完作借口。你同意。四十丈险处先动工，其他地方仍须等。她走前量了一次衙门台阶，说若第二笔拖了，至少知道这些工人该站在哪一层向你开口。
-> END
* [按新差役名额征工，旧欠另查]
~ choice_id = "c"
你命按役额集人，旧工钱留待查明经手后支付。陆青禾收起绳尺，说她会把险段指出，但不能替新来的人担保。几日后，人手在册上齐了，有两个才第一次下水。程守义请求多派熟工带领，额外工钱又回到了桌上。你已经发出的命令能让人来到河边，不能让他们立刻听懂水的声音。
-> END
