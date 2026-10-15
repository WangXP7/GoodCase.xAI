export const VERSION = '0.1.0';
export const statNames = {silver:'公银',grain:'仓粮',welfare:'民生',order:'秩序',works:'水利',trust:'民望',standing:'考成',integrity:'清议'};
export type Stat = keyof typeof statNames;
export type Stats = Record<Stat,number>;
export const initial: Stats = {silver:90,grain:90,welfare:50,order:50,works:35,trust:45,standing:45,integrity:55};
export const chapters = ['接印','春水','秋账','寒灯','新汛','去留'];
export const people = [
 {id:'shen',name:'沈砚',role:'刑房书吏',place:'刑房',bio:'字写得极小，账记得极清。他总先把事情说明白，再承认自己也在那件事里。'},
 {id:'lu',name:'陆青禾',role:'河工匠首',place:'东堤',bio:'腰间挂着一截磨亮的绳尺。她不许任何人用一句“尽力了”，替代一个工人的名字。'},
 {id:'he',name:'何素娘',role:'豆腐坊主人',place:'南街',bio:'天不亮便磨豆，一天的亏盈算到文。她要女儿能以自己的名字签一张契。'},
 {id:'wei',name:'魏廷章',role:'本县举人',place:'西乡',bio:'一县的体面和一家人的体面，他盼着两全；水涨起来时，岸却只能有一条。'},
 {id:'sang',name:'桑九',role:'临溪渡夫',place:'老渡口',bio:'熟识夜里的水路，白天却常在名册上找不到自己。笑话说得多，真话藏在最后。'},
 {id:'xu',name:'许照微',role:'乡间医者',place:'药铺',bio:'看病先问昨夜谁守在床边。她记药，也记一个病人能不能喝到干净水。'},
 {id:'cheng',name:'程守义',role:'本县典史',place:'县衙',bio:'一双旧靴补了三回。他信规矩能挡住最坏的事，也怕规矩只是让弱者先低头。'},
 {id:'luo',name:'罗问渠',role:'府衙承行',place:'往来府县',bio:'公文上不多一个字，话却常说到一半。留出的空白究竟给谁，要到最后才知道。'}
];
export const items: Record<string,{name:string;desc:string}> = {
 ledger:{name:'旧仓底簿',desc:'仓粮出入与领粮人的原始记录，沈砚补记的日期仍可辨认。'},
 boats:{name:'渡船副单',desc:'由船户签押的运粮副本，可与官册相互核对。'},
 receipt:{name:'封存征解联',desc:'秋粮交割的第三联，保留了府县经手人的记号。'},
 white:{name:'何家白契',desc:'经询证保全的旧契副本，不以一枚缺失的官印抹去当事人的生活。'},
 survey:{name:'两岸水尺图',desc:'陆青禾与两岸住户共同确认的水位及堤身记录。'},
 clinic:{name:'无名医案',desc:'患者可不记姓名；水源、病程与照护办法逐条可查。'},
 pact:{name:'相济约簿',desc:'各坊自愿签订的互助规则，写明退出、查账与轮值办法。'}
};
export type Requirement = {stat?:Stat;min?:number;flag?:string;value?:number;item?:string;proof?:number;shadow?:number};
export type Effect = {stats?:Partial<Stats>;items?:string[];rel?:[string,number][];shadow?:number};
export type Option = {id:string;label:string;effect:Effect;requires?:Requirement[];ending?:string};
export type Event = {id:string;title:string;chapter:number;month:number;category:'主线'|'事务'|'人物'|'回响';cast:string[];options:Option[];after?:string[];priority:number;once:true;role:string;place:string};
const c=(id:string,label:string,stats:Partial<Stats>={},extra:Omit<Effect,'stats'>={},requires?:Requirement[]):Option=>({id,label,effect:{stats,...extra},requires});
const e=(id:string,title:string,chapter:number,month:number,category:Event['category'],cast:string[],options:Option[],after?:string[]):Event=>({id,title,chapter,month,category,cast,options,after,priority:category==='主线'?100:category==='回响'?90:50,once:true,role:'知县',place:'临溪县'});
export const events:Event[] = [
 e('M01','印落在缺口上',0,1,'主线',['shen','cheng'],[c('a','先点实仓，把缺额写进交接',{standing:-3,integrity:5,trust:3}),c('b','暂接旧额，另立一册暗查',{standing:3,order:2}),c('c','照旧数签收，先让衙门转起来',{standing:5,integrity:-6},{shadow:1})]),
 e('V01','沈砚的第三种字',0,1,'人物',['shen'],[c('a','封存原簿，让沈砚附上亲笔说明',{integrity:4},{items:['ledger'],rel:[['shen',4]]}),c('b','抄下可核的条目，暂留原簿在刑房',{standing:3},{rel:[['shen',1]]}),c('c','退回簿册，不把前任旧事带入新任',{order:3,integrity:-3},{shadow:1,rel:[['shen',-2]]})]),
 e('A01','半枚手印的白契',0,2,'事务',['he','cheng'],[c('a','传四邻询证，补成公开可核的契据',{silver:-4,trust:5},{items:['white'],rel:[['he',4]]}),c('b','先保住铺面，限双方另议租期',{order:4,welfare:2},{rel:[['he',1]]}),c('c','依现册退还房屋，免去追征旧欠',{standing:3,trust:-3},{rel:[['he',-3]]})]),
 e('V02','一把绳尺',0,2,'人物',['lu'],[c('a','先付旧工钱，换一张逐段验工表',{silver:-12,works:9,trust:3},{rel:[['lu',4]]}),c('b','约定分期，先修最险的四十丈',{silver:-5,works:6},{rel:[['lu',1]]}),c('c','按新差役名额征工，旧欠另查',{works:3,order:-3,trust:-4},{rel:[['lu',-3]]})]),
 e('A02','桥下不识字的人',0,2,'事务',['sang'],[c('a','把渡税与工役分列，准船户自己报名',{silver:-3,order:3,trust:4},{rel:[['sang',3]]}),c('b','用现有里甲作保，先减一季渡税',{silver:-5,welfare:3},{rel:[['sang',1]]}),c('c','保留税额，让渡户分期缴清',{silver:6,standing:3,trust:-3},{rel:[['sang',-2]]})]),
 e('R01','船底那一行小字',0,2,'回响',['sang','shen'],[c('a','存下副单，并记录船户自认的夹带',{integrity:4,standing:-2},{items:['boats'],rel:[['sang',2]]}),c('b','只校正粮数，私盐另案处理',{order:4,standing:2},{rel:[['sang',-1]]}),c('c','以船户欠税抵消账差，封结此项',{silver:4,integrity:-5},{shadow:1})],['A02','V01']),
 e('M02','仓门打开以前',0,3,'主线',['xu','cheng','shen'],[c('a','按实际人口开粥，同时留下实名异议栏',{grain:-12,welfare:8,trust:4,standing:-2}),c('b','照在册户先发，另设三日补录',{grain:-8,welfare:5,order:4}),c('c','保留籽种，只向无力做饭者给熟食',{grain:-5,welfare:2,order:3})]),
 e('M03','春水没有副本',1,3,'主线',['lu','wei'],[c('a','照实测先修东堤，公开占地与赔偿',{silver:-10,works:10,integrity:3},{items:['survey'],rel:[['lu',3],['wei',-2]]}),c('b','先筑临时围堰，给两岸留出协商期',{silver:-6,works:6,order:3},{rel:[['wei',2]]}),c('c','沿旧界加高，保证册图与工程相合',{silver:-4,works:3,standing:4},{rel:[['lu',-2]]})]),
 e('V03','魏宅借来的春天',1,3,'人物',['wei'],[c('a','收借粮，写明利息上限与公开偿期',{grain:16,standing:-2},{rel:[['wei',2]]}),c('b','收无息捐粮，允许题名但不许包揽工程',{grain:10,trust:2,standing:2},{rel:[['wei',1]]}),c('c','谢绝附带条件，从公银采买',{silver:-9,grain:12,integrity:4},{rel:[['wei',-2]]})]),
 e('A03','药渣里的一截根',1,4,'事务',['xu','cheng'],[c('a','暂停涉案药材，逐户追访并公开更正',{silver:-4,welfare:5,integrity:3},{rel:[['xu',4]]}),c('b','先赔病户，再请两位医者共同验方',{silver:-6,welfare:4,order:3},{rel:[['xu',1]]}),c('c','只查进货与误用，不先判医方有罪',{order:3,standing:2},{rel:[['xu',2]]})]),
 e('A04','水往谁的田里去',1,4,'事务',['wei','lu'],[c('a','拆私埂，按实损补偿两岸',{silver:-9,works:8,trust:3},{rel:[['wei',-3],['lu',3]]}),c('b','开限时分水口，让两岸共同守尺',{works:5,order:5},{rel:[['wei',2],['lu',1]]}),c('c','守旧界，另掘小渠救下游急旱',{silver:-5,works:2,welfare:3},{rel:[['wei',3],['lu',-2]]})]),
 e('V04','名字写在纸背',1,5,'人物',['he'],[c('a','借空廊开夜学，男女分时且自愿入册',{silver:-4,welfare:4,trust:3},{rel:[['he',4]]}),c('b','请书铺授字，由学者自备纸笔',{welfare:2,order:2},{rel:[['he',2]]}),c('c','先教契约与算账，不另立学馆名目',{silver:-2,welfare:3,standing:2},{rel:[['he',1]]})]),
 e('R02','绳结松开的那夜',1,5,'回响',['lu','sang'],[c('a','依匠首判断撤人保命，次日重测',{works:-2,welfare:5,trust:4},{rel:[['lu',3]]}),c('b','增派轮班守堤，把最弱的一段卸压',{silver:-5,works:4,order:4}),c('c','先转移下游住户，保留少数熟手察看',{grain:-4,welfare:4,order:3},{rel:[['sang',2]]})],['V02','M03','A04']),
 e('M04','限期之外的第三天',1,6,'主线',['luo','shen'],[c('a','把迟误与补救一并具报',{standing:-4,integrity:6},{rel:[['luo',1]]}),c('b','先交可核部分，申请补卷',{standing:5,order:2},{rel:[['luo',3]]}),c('c','提前验工日期，赶在封套前送出',{standing:7,integrity:-7},{shadow:1,rel:[['luo',-2]]})]),
 e('M05','秋粮的第三联',2,8,'主线',['shen','luo'],[c('a','把争议征解联封存，照实数分批解送',{standing:-3,integrity:5},{items:['receipt'],rel:[['shen',3]]}),c('b','请府县共同复点，留下一份会签说明',{silver:-4,standing:6,order:3},{rel:[['luo',3]]}),c('c','以本县余项垫平差额，结清本季',{silver:-8,standing:7,integrity:-5},{shadow:1})]),
 e('V05','渡夫不肯领赏',2,8,'人物',['sang'],[c('a','补记全部船工，赏钱由他们推举分配',{silver:-5,trust:5},{rel:[['sang',4]]}),c('b','把赏钱转为公用修船料，逐次登记',{silver:-4,works:3,order:3},{rel:[['sang',2]]}),c('c','照已有名册发放，允许另报漏名',{silver:-3,standing:3,trust:1},{rel:[['sang',-1]]})]),
 e('A05','一个不能报出的姓',2,9,'事务',['he','shen'],[c('a','以抚养与现居证据记名，封存旧身份争议',{trust:4,integrity:3},{rel:[['he',3]]}),c('b','先准旁听学习，籍贯留待原乡回文',{welfare:3,standing:3},{rel:[['he',1]]}),c('c','发临时寄学凭据，写明不得冒认宗族',{order:4,welfare:2})]),
 e('A06','逃役人的鞋',2,9,'事务',['cheng','shen'],[c('a','查替役钱流向，欠役按实情重新分担',{order:2,trust:5,integrity:3},{rel:[['cheng',-1]]}),c('b','先给三日照护假，程守义负责复核',{welfare:3,order:5},{rel:[['cheng',3]]}),c('c','役期不免，以近家轻役替远役',{order:4,standing:3,trust:-1},{rel:[['cheng',2]]})]),
 e('R03','她递来的不是状纸',2,10,'回响',['he'],[c('a','请她把错误也写进义学账',{integrity:4,trust:3},{rel:[['he',3]]}),c('b','准其轮值看账，按月轮换经手人',{order:4,welfare:2},{rel:[['he',2]]}),c('c','由书吏协助核算，保留她的原稿',{standing:3,welfare:2},{rel:[['he',1]]})],['A01','V04','A05']),
 e('M06','秋闸最后一尺',2,10,'主线',['lu','wei','sang'],[c('a','先放水保下游，登记上游损失',{works:5,welfare:4,standing:-2},{rel:[['lu',3],['wei',-2]]}),c('b','按水尺轮换开闸，两岸各出一名见证',{works:5,order:5},{rel:[['wei',2]]}),c('c','保留蓄水，多备一批冬粮',{grain:8,works:-2,welfare:-2},{rel:[['lu',-2]]})]),
 e('M07','靴底上的公银',3,11,'主线',['cheng'],[c('a','清偿欠饷，公开差役不得另取的费用',{silver:-10,order:8,integrity:4},{rel:[['cheng',3]]}),c('b','先付半饷，以轮休和公食缓一月',{silver:-5,grain:-3,order:5},{rel:[['cheng',2]]}),c('c','先清空名，实役先发一部分饷',{silver:-3,order:2,standing:5},{rel:[['cheng',-1]]})]),
 e('V06','族谱少掉的一页',3,11,'人物',['wei'],[c('a','准族中自议，公产争议另立公案',{integrity:4,order:3},{rel:[['wei',2]]}),c('b','暂缓旌表，先核义田受益名册',{standing:3,trust:3},{rel:[['wei',1]]}),c('c','退回旌表请求，请魏氏先安置佃户',{trust:4,welfare:2},{rel:[['wei',-2]]})]),
 e('A07','夜航没有凶手',3,12,'事务',['sang','cheng'],[c('a','分别记录过失，先救济失踪者家属',{silver:-5,welfare:4,integrity:3},{rel:[['sang',2]]}),c('b','暂封险渡，合请熟手重定夜航规矩',{order:6,works:2},{rel:[['sang',1]]}),c('c','逐项勘验后再归责，禁止传讯家属',{order:3,standing:3,trust:2},{rel:[['cheng',2]]})]),
 e('A08','墙上写着一个药字',3,13,'事务',['xu'],[c('a','清井分水，征用空屋安置病家',{silver:-7,welfare:7,order:2},{rel:[['xu',4]]}),c('b','先逐户巡诊，发煮水柴与照护说明',{grain:-4,welfare:5,order:3},{rel:[['xu',2]]}),c('c','封病井而不封整坊，设自报症状点',{welfare:3,order:4,standing:2},{rel:[['xu',1]]})]),
 e('R04','祠门向哪边开',3,13,'回响',['wei','xu'],[c('a','借祠廊安置，明定归还与清理责任',{welfare:6,order:3},{rel:[['wei',3],['xu',2]]}),c('b','只借外院作物资点，病家另住',{silver:-3,welfare:4,order:4},{rel:[['wei',2]]}),c('c','不用祠产，改修废驿作临时病舍',{silver:-8,welfare:5,works:2},{rel:[['wei',-1]]})],['V03','A04','V06','A08']),
 e('M08','不许经过的街',3,14,'主线',['xu','cheng','he'],[c('a','开定时通行口，由邻里报送需求',{order:3,welfare:6,trust:3},{rel:[['xu',2]]}),c('b','维持分区，增设送药与赊粮登记',{grain:-5,order:6,welfare:4},{rel:[['cheng',2]]}),c('c','按户解除限制，公布复查与申诉办法',{order:4,standing:3,integrity:3})]),
 e('M09','第二次水声',4,16,'主线',['lu','sang'],[c('a','按旧图提前疏散，保护水尺与救援路',{grain:-6,welfare:6,order:3},{rel:[['lu',3]]}),c('b','集中银料补险口，维持粮船往来',{silver:-7,works:8,standing:3},{rel:[['sang',2]]}),c('c','分区轮守，让当地熟手决定撤离时点',{works:4,order:5,trust:2})]),
 e('V07','医案不写功德',4,16,'人物',['xu'],[c('a','保留匿名病程，拨纸墨抄给乡间',{silver:-3,welfare:4,integrity:3},{items:['clinic'],rel:[['xu',4]]}),c('b','交两位医者会阅，只记能重复核对的经验',{welfare:3,standing:3},{items:['clinic'],rel:[['xu',2]]}),c('c','先留底本，删去未经核实的归因再传抄',{order:3,integrity:3},{items:['clinic'],rel:[['xu',1]]})]),
 e('A09','铺面传给谁',4,17,'事务',['he','wei'],[c('a','确认亲笔处分意思，分列铺面与祭产',{trust:5,integrity:3},{rel:[['he',3],['wei',-1]]}),c('b','先为母女设稳定使用约，再议所有权',{welfare:4,order:4},{rel:[['he',1],['wei',2]]}),c('c','补足各方见证，暂封有争议的租金',{silver:-2,standing:4,order:3})]),
 e('R05','同一册账的两种读法',4,18,'回响',['shen','luo'],[c('a','分清受益、经手与决策人，原件不改',{integrity:6,standing:-3},{rel:[['shen',3],['luo',1]]}),c('b','逐项附会签说明，争议留待上级复核',{standing:6,order:3},{rel:[['luo',3]]}),c('c','将争议并入旧欠，只报本任改善数',{standing:7,integrity:-7},{shadow:1,rel:[['shen',-3]]})],['M01','V01','R01','M04','M05']),
 e('R06','窗下两盏灯',4,19,'回响',['he','xu'],[c('a','留下相互纠错的办法，公银只付纸墨',{silver:-3,welfare:5,trust:3},{rel:[['he',2],['xu',2]]}),c('b','将夜学与医案分开保管，按月交换缺漏',{order:4,welfare:3}),c('c','由坊中轮值，把关门钥匙交给两位新学者',{trust:4,welfare:3})],['A01','V04','R03','A08','V07','A09']),
 e('M10','谁来保管第二把钥匙',4,20,'主线',['wei','he','sang','xu'],[c('a','立相济约，明定退约与查账权',{silver:-6,grain:-6,trust:5},{items:['pact']}),c('b','由县衙设公簿，先试一季轮值',{silver:-3,order:6,standing:4}),c('c','各坊自管余粮，县衙只受理争议',{welfare:3,integrity:4})]),
 e('M11','验官来到县门',5,21,'主线',['luo','shen','cheng'],[c('a','交原件与经手名单，自己的批语也不摘除',{integrity:7,standing:-2},{rel:[['shen',3],['cheng',1]]}),c('b','分为已核与待核两卷，逐事口陈',{standing:7,order:3},{rel:[['luo',3]]}),c('c','以本任成果为总纲，旧案仅列数字',{standing:6,integrity:-5},{shadow:1})]),
 e('V08','程守义请辞',5,21,'人物',['cheng'],[c('a','准他卸去领差，留下训练新人的职责',{order:3,trust:3},{rel:[['cheng',3]]}),c('b','留任一季，先将差费与惩戒办法交接',{order:6,standing:3},{rel:[['cheng',1]]}),c('c','准其辞役回家，把旧处分完整留卷',{integrity:4,order:-2},{rel:[['cheng',2]]})]),
 e('A10','牢里寄出的家书',5,22,'事务',['cheng','shen'],[c('a','复核羁押期限，分别上报并安排家属探视',{silver:-3,integrity:5,welfare:3}),c('b','先补送失联书信，再逐案催结',{order:4,standing:3,trust:2}),c('c','请上级会审久悬之案，费用列为公支',{silver:-5,standing:5,integrity:3})]),
 e('R07','刻度留给后来的人',5,22,'回响',['lu'],[c('a','把失误水位也刻上，交两岸共同维护',{works:5,integrity:4},{rel:[['lu',3]]}),c('b','立常年修缮簿，给继任者列清支出',{silver:-3,works:6,standing:3},{rel:[['lu',2]]}),c('c','把验工权交给常年守堤的工户',{works:4,trust:4},{rel:[['lu',3]]},[{stat:'works',min:60}])],['V02','M03','R02','M06','M09']),
 e('R08','名册上的最后一条船',5,23,'回响',['sang','he'],[c('a','按船工自报与互证保留不同姓名',{trust:5,integrity:3},{rel:[['sang',3]]}),c('b','旧名新名并存，给每户一张可带走的副单',{silver:-2,order:4,welfare:3},{rel:[['sang',3]]}),c('c','将无主款封存，准遗属以后凭证来领',{silver:3,standing:3,integrity:2})],['A02','R01','V05','A07']),
 e('M12','去留簿',5,24,'主线',['luo','shen'],[
 {...c('a','留任临溪，把未竟之事交给下一季',{}, {},[{stat:'welfare',min:50},{stat:'order',min:50}]),ending:'E01'},
 {...c('b','接受调署，带着可核的办法赴府',{}, {},[{stat:'standing',min:60}]),ending:'E02'},
 {...c('c','缴印归乡，完整交接自己的得失'),ending:'E03'},
 {...c('d','携三份原始凭据，请求上呈复核',{}, {},[{proof:3}]),ending:'E04'},
 {...c('e','辞官留县，以平民身份参与相济约',{}, {},[{item:'pact'}]),ending:'E05'},
 {...c('f','接受改写后的考语，封结争议账目',{}, {},[{shadow:2}]),ending:'E06'}
 ])
];
export const obligations:Record<string,{flag:string;equals:number;stats:Partial<Stats>}[]> = {
 M03:[{flag:'v02',equals:2,stats:{silver:-7}}],
 M06:[{flag:'v03',equals:1,stats:{grain:-16,silver:-2}}],
 A07:[{flag:'m07',equals:2,stats:{silver:-5}},{flag:'m07',equals:3,stats:{silver:-7}}]
};
export const endingTitles:Record<string,string>={E01:'春在县门外',E02:'一纸调令',E03:'归舟无印',E04:'带卷北行',E05:'灯火相借',E06:'无字考语'};
export const policyActions = [
 {id:'repair',name:'修补公共水工',desc:'购置木石，雇用本地工户。公银 −8，水利 +7。',stats:{silver:-8,works:7}},
 {id:'relief',name:'补充坊间公食',desc:'留足照护者的口粮。仓粮 −8，民生 +7。',stats:{grain:-8,welfare:7}},
 {id:'clerks',name:'清点差费与交接',desc:'付清文书、差役实支。公银 −5，秩序 +4，考成 +3。',stats:{silver:-5,order:4,standing:3}}
];
