/**
 * Proposed pure reference algorithms, NOT an applied production patch.
 * No imports, I/O, clocks, random dice, session store or persistence.
 * Functions return new state; production adapters retain ownership/revision guards.
 * derive(state) must provide the current production derived-stat shape.
 */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const plain = v => v !== null && typeof v === 'object' &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const clone = v => structuredClone(v);
const fail = m => { throw new Error(m); };
const assert = (v, m) => { if (!v) fail(m); };
const put = (o, k, v) => Object.defineProperty(o, k, {value:v, writable:true, configurable:true, enumerable:true});
export function integer(raw, min = 0, max = Number.MAX_SAFE_INTEGER) {
  assert(typeof raw === 'number' || typeof raw === 'string', 'Expected an integer');
  if (typeof raw === 'string') assert(/^[+-]?\d+$/.test(raw.trim()), 'Nonempty integer required');
  const n = Number(raw);
  assert(Number.isSafeInteger(n) && n >= min && n <= max, 'Integer outside allowed range');
  return n;
}
function object(v, label) { assert(plain(v), `${label} must be an object`); return v; }
function text(v, label) { assert(typeof v === 'string' && v.length > 0 && v.length <= 1024, `${label} required`); return v; }
function sara(s) { assert(s?.profile?.id === 'sara-velaris', 'Sara owner required'); }
function stable(v, seen = new Set()) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') { assert(Number.isSafeInteger(v), 'Unsafe request number'); return String(v); }
  assert(Array.isArray(v) || plain(v), 'Unsupported request value');
  assert(!seen.has(v), 'Cyclic request'); seen.add(v);
  const result = Array.isArray(v) ? '[' + v.map(x => stable(x, seen)).join(',') + ']'
    : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k], seen)).join(',') + '}';
  seen.delete(v); return result;
}
export function validateFunctionalRuntime(s) {
  const r = s?.monk?.functionalRuntime;
  if (r === undefined) return;
  object(r, 'functionalRuntime'); assert(r.version === 1, 'Unsupported functionalRuntime version');
  object(r.operations, 'operations');
  for (const id of Object.keys(r.operations)) {
    text(id, 'operation ID'); const x = object(r.operations[id], 'receipt');
    text(x.kind, 'receipt kind'); text(x.requestKey, 'receipt request key'); stable(x.outcome);
  }
  assert(own(r, 'rest'), 'rest field required');
  if (r.rest === null) return;
  const rest = object(r.rest, 'rest'); text(rest.id, 'rest ID');
  assert(['short','long'].includes(rest.kind), 'Invalid rest kind');
  const phases = rest.kind === 'short' ? ['hit-dice','finished','superseded']
    : ['replacement-offer','replacement-edit','finished','superseded'];
  assert(phases.includes(rest.phase), 'Invalid rest phase');
  integer(rest.hitDiceSpent ?? 0);
}
function runtime(d) {
  d.monk ??= {};
  d.monk.functionalRuntime ??= {version:1, operations:{}, rest:null};
  return d.monk.functionalRuntime;
}
export function recordedMutation(state, intent, mutate) {
  sara(state); validateFunctionalRuntime(state);
  const id = text(intent.id, 'operation ID');
  const kind = text(intent.kind, 'operation kind');
  const requestKey = stable({kind, payload:intent.payload});
  assert(requestKey.length <= 1024, 'Request too large');
  const receipts = state.monk?.functionalRuntime?.operations;
  if (receipts && own(receipts, id)) {
    const receipt = receipts[id];
    assert(receipt.kind === kind && receipt.requestKey === requestKey, 'Operation ID reused with different request');
    return {state, outcome:clone(receipt.outcome), replayed:true};
  }
  const draft = clone(state); const r = runtime(draft);
  const outcome = mutate(draft); stable(outcome);
  put(r.operations, id, {kind, requestKey, outcome:clone(outcome)});
  validateFunctionalRuntime(draft);
  return {state:draft, outcome:clone(outcome), replayed:false};
}
export const POTIONS = Object.freeze({
  'healing-potion': {name:'Маленькое зелье лечения', dice:2, bonus:2},
  'greater-healing-potion': {name:'Среднее зелье лечения', dice:4, bonus:4},
  'superior-healing-potion': {name:'Большое зелье лечения', dice:8, bonus:8},
  'supreme-healing-potion': {name:'Великое зелье лечения', dice:10, bonus:20},
});
export function starterItems() {
  const item = (id,name,quantity=1,extra={}) => ({id,name,type:'misc',quantity,equipped:false,notes:'',tags:[],...extra});
  return [
    item('amulet-of-health','Амулет здоровья',1,{equipped:true,attuned:true}),
    item('insignia-of-claws','Эмблема когтей',1,{equipped:true,requiresAttunement:false}),
    item('velaris-signet-ring','Кольцо с гербом дома Веларис',1,{tags:['священный символ'],description:'Личный священный символ без дополнительных магических бонусов.'}),
    item('club','Дубинка',1,{type:'weapon',weapon:{category:'simple-melee',proficiencyName:'Club',attackStat:'strength',damageDice:'1d4',damageType:'bludgeoning',properties:['light'],magicalBonusAttack:0,magicalBonusDamage:0}}),
    item('darts','Дротики',20,{type:'weapon',weapon:{category:'ranged',proficiencyName:'Dart',attackStat:'dexterity',damageDice:'1d4',damageType:'piercing',properties:['finesse','thrown'],range:'20/60',magicalBonusAttack:0,magicalBonusDamage:0}}),
    item('thieves-tools','Воровские инструменты'), item('playing-cards','Игральные карты'),
    item('backpack','Рюкзак'), item('bedroll','Спальный мешок'), item('mess-kit','Столовый набор'),
    item('tinderbox','Трутница'), item('torches','Факелы',10), item('rations','Рационы',10,{unit:'дневная порция'}),
    item('waterskin','Бурдюк'), item('hempen-rope','Пеньковая верёвка',1,{lengthFeet:50}),
    item('crowbar','Ломик'), item('hooded-common-clothes','Тёмная обычная одежда с капюшоном'),
    item('belt-pouch','Поясной кошель'),
    ...Object.entries(POTIONS).map(([id,p]) => item(id,p.name,0,{type:'consumable',consumable:{kind:'healing-potion',potionId:id}})),
  ];
}
const normalizeName = x => String(x ?? '').normalize('NFKC').trim().toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ');
const ALIASES = {
  'club':['club'], 'darts':['dart','darts','дротик'], 'playing-cards':['playing cards','колода игральных карт'],
  'healing-potion':['potion of healing'], 'greater-healing-potion':['potion of greater healing'],
  'superior-healing-potion':['potion of superior healing'], 'supreme-healing-potion':['potion of supreme healing'],
};
function compatible(actual, canonical) {
  if (canonical.weapon && actual.weapon != null) {
    if (!plain(actual.weapon)) return false;
    if (actual.weapon.category != null && actual.weapon.category !== canonical.weapon.category) return false;
    if (actual.weapon.damageDice != null && actual.weapon.damageDice !== canonical.weapon.damageDice) return false;
  }
  if (own(POTIONS,canonical.id) && actual.consumable != null) {
    if (!plain(actual.consumable)) return false;
    if (actual.consumable.potionId != null && actual.consumable.potionId !== canonical.id) return false;
    if (actual.consumable.kind != null && actual.consumable.kind !== 'healing-potion') return false;
  }
  return Number.isSafeInteger(actual.quantity) && actual.quantity >= 0;
}
export function validateStarterManifest(s) {
  const m = s.inventory?.starterManifest;
  if (m === undefined) return;
  object(m,'starterManifest'); assert(m.version === 1,'Unsupported starterManifest version');
  object(m.bindings,'manifest bindings');
  assert(Array.isArray(m.preservedAbsences) && m.preservedAbsences.every(x => typeof x === 'string'),'Invalid preserved absences');
  assert(Array.isArray(m.conflicts),'Invalid manifest conflicts');
  for (const key of Object.keys(m.bindings)) text(m.bindings[key],'bound item ID');
  for (const c of m.conflicts) {
    object(c,'manifest conflict'); text(c.slot,'conflict slot'); text(c.reason,'conflict reason');
    assert(Array.isArray(c.candidates) && c.candidates.every(x => typeof x === 'string'),'Invalid conflict candidates');
  }
}
export function adoptStarter(state) {
  sara(state); validateStarterManifest(state);
  if (state.inventory?.starterManifest) return {state, changed:false};
  const d = clone(state); object(d.inventory,'inventory');
  assert(Array.isArray(d.inventory.items),'Inventory items required');
  const inv=d.inventory, list=inv.items;
  const m={version:1,bindings:{},preservedAbsences:[],conflicts:[]};
  const unfilled=inv.otherItemsStatus === 'Не заполнено';
  for (const canonical of starterItems()) {
    const aliases=new Set([canonical.name,...(ALIASES[canonical.id]??[])].map(normalizeName));
    const candidates=list.filter(x => x?.id === canonical.id || aliases.has(normalizeName(x?.name)));
    const ids=candidates.map(x=>String(x?.id??''));
    if (candidates.length>1 || candidates.some(x=>list.filter(y=>y?.id===x.id).length>1)) {
      m.conflicts.push({slot:canonical.id,reason:'ambiguous-or-duplicate',candidates:ids}); continue;
    }
    if (candidates.length===1) {
      const actual=candidates[0];
      if (typeof actual.id !== 'string' || !actual.id || !compatible(actual,canonical)) {
        m.conflicts.push({slot:canonical.id,reason:'incompatible-item',candidates:ids}); continue;
      }
      put(m.bindings,canonical.id,actual.id); continue;
    }
    if (unfilled || own(POTIONS,canonical.id)) {
      list.push(clone(canonical)); put(m.bindings,canonical.id,canonical.id);
    } else m.preservedAbsences.push(canonical.id);
  }
  if (inv.currency === null && inv.currencyStatus === 'Не заполнено') {
    inv.currency={cp:0,sp:0,ep:0,gp:15,pp:0}; inv.currencyStatus='Заполнено';
  }
  inv.starterManifest=m;
  if (unfilled) inv.otherItemsStatus=m.conflicts.length?'Заполнено частично':'Заполнено';
  validateStarterManifest(d);
  return {state:d,changed:true};
}
export function resolveStarterSlot(state, slot, choice) {
  sara(state);validateStarterManifest(state);
  const d=clone(state),m=d.inventory?.starterManifest;
  assert(m,'Manifest required');
  const c=m.conflicts.find(x=>x.slot===slot);assert(c,'No unresolved conflict for slot');
  const canonical=starterItems().find(x=>x.id===slot);assert(canonical,'Unknown slot');
  if (choice.mode==='keep-custom') {
    if (!m.preservedAbsences.includes(slot)) m.preservedAbsences.push(slot);
  } else if (choice.mode==='bind') {
    const matches=d.inventory.items.filter(x=>x.id===choice.itemId);
    assert(matches.length===1 && compatible(matches[0],canonical),'Selected item is not uniquely compatible');
    put(m.bindings,slot,matches[0].id);
  } else if (choice.mode==='add') {
    assert(!d.inventory.items.some(x=>x.id===slot),'Canonical ID already exists');
    d.inventory.items.push(clone(canonical));put(m.bindings,slot,slot);
  } else fail('Unknown conflict decision');
  m.conflicts=m.conflicts.filter(x=>x.slot!==slot);return d;
}
export function initializeNewSara(defaults, derive) {
  sara(defaults);let d=clone(defaults);
  d.monk ??= {};d.monk.functionalRuntime={version:1,operations:{},rest:null};
  d.monk.replacementEntitlements=[];d.monk.replacementEvents=[];d.monk.ordinaryReplacementCredit=0;
  d.monk.combatAssistant={schemaVersion:1,activeSequences:[],pendingApplications:[],recentlyCompletedSummaries:[]};
  d.battleConsole={current:null,history:[]};d.combat.concentration='';
  d.ui ??= {};d.ui.activeEffects=[];d.ui.turn={actionUsed:false,bonusActionUsed:false,reactionUsed:false,turnNumber:1};
  delete d.inventory.starterManifest;
  d.inventory.otherItemsStatus='Не заполнено';
  d=adoptStarter(d).state;
  const x=derive(d); d.combat.hp.current=integer(x.maxHitPoints);d.combat.hp.temp=0;
  d.combat.ki.current=integer(x.monk.kiMaximum);d.combat.practiced.current=integer(x.monk.practicedMaximum);
  d.combat.hitDice={total:integer(d.profile.level,1,20),remaining:integer(d.profile.level,1,20)};
  for (const spell of d.spellcasting?.racialSpells??[]) if (spell.uses) spell.uses.current=integer(spell.uses.max);
  return d;
}
function itemById(d,id) {
  text(id,'item ID');const matches=d.inventory?.items?.filter(x=>x.id===id)??[];
  assert(matches.length===1,'Item missing or duplicate ID');integer(matches[0].quantity);return matches[0];
}
function boundItem(d,slot,id) {
  validateStarterManifest(d);
  const binding=d.inventory?.starterManifest?.bindings;
  assert(binding && own(binding,slot) && binding[slot]===id,'Canonical item binding required');
  return itemById(d,id);
}
export function changeQuantity(s, request) {
  const mode=request.mode;assert(['delta','set'].includes(mode),'Quantity mode required');
  const value=integer(request.value,mode==='delta'?-Number.MAX_SAFE_INTEGER:0);
  const p={itemId:text(request.itemId,'item ID'),mode,value};
  return recordedMutation(s,{id:request.id,kind:'quantity',payload:p},d=>{
    const item=itemById(d,p.itemId),before=item.quantity;
    const after=mode==='set'?value:before+value;integer(after);
    item.quantity=after;return {itemId:item.id,before,after};
  });
}
export function closeRestWindow(d, reason) {
  validateFunctionalRuntime(d);const r=d.monk?.functionalRuntime?.rest;
  text(reason,'activity reason');
  if (r && !['finished','superseded'].includes(r.phase)) {
    r.phase='superseded';r.supersededReason=reason;
  }
  for (const e of d.monk.replacementEntitlements??[]) {
    if(e.type==='rest'&&!e.consumed&&!e.declined&&!e.superseded) e.superseded=true;
  }
  d.monk.ordinaryReplacementCredit=0;
}
export function previewPotion(s, request, derive) {
  sara(s);const p=POTIONS[request.potionId];assert(p,'Unknown potion');
  const sum=integer(request.sum,p.dice,p.dice*4),target=request.target??'self';
  assert(['self','other'].includes(target),'Potion target required');
  const item=boundItem(s,request.potionId,request.itemId);assert(item.quantity>0,'No potion stock');
  const hp=integer(s.combat.hp.current);assert(hp>0,'Sara cannot perform this use at 0 HP');
  const b=s.battleConsole?.current;
  if(b&&b.phase!=='ended') {
    assert(b.phase==='own-turn','Own turn required');assert(s.ui?.turn?.actionUsed!==true,'Action already used');
  }
  const max=integer(derive(s).maxHitPoints);assert(hp<=max,'HP exceeds maximum');
  assert(target!=='self'||hp<max||request.intentionalWaste===true,'HP full');
  return {sum,healing:sum+p.bonus,usefulHealing:target==='self'?Math.min(max-hp,sum+p.bonus):null,
    hpBefore:hp,hpAfter:target==='self'?Math.min(max,hp+sum+p.bonus):hp,
    target,spendAction:Boolean(b&&b.phase!=='ended')};
}
export function usePotion(s, request, derive) {
  const p=POTIONS[request.potionId];assert(p,'Unknown potion');
  const payload={potionId:request.potionId,itemId:text(request.itemId,'item ID'),target:request.target??'self',
    sum:integer(request.sum,p.dice,p.dice*4),intentionalWaste:request.intentionalWaste===true};
  return recordedMutation(s,{id:request.id,kind:'potion',payload},d=>{
    const x=previewPotion(d,payload,derive),item=boundItem(d,payload.potionId,payload.itemId);
    item.quantity--; d.combat.hp.current=x.hpAfter;
    if(x.spendAction)d.ui.turn.actionUsed=true;
    closeRestWindow(d,'potion-use');return {...x,itemId:item.id,stockAfter:item.quantity};
  });
}
export function hasPendingIncomingHp(s) {
  return (s.characterRolls?.records??[]).some(r =>
    ['ability-check','saving-throw'].includes(r.kind) &&
    ['pending','awaiting-damage-decision','awaiting-damage-input'].includes(r.consequence?.status));
}
function retireRestRights(d) {
  for(const e of d.monk.replacementEntitlements??[]) if(e.type==='rest'&&!e.consumed&&!e.declined&&!e.superseded)e.superseded=true;
  d.monk.ordinaryReplacementCredit=0;
}
export function eligibleEntitlement(event, state) {
  if(!event||event.consumed||event.declined||event.superseded)return false;
  if(event.type==='level-up')return true; // Production still applies existing level-up validity rules.
  if(event.type!=='rest')return false;
  const r=state.monk?.functionalRuntime?.rest;
  if (event.restId == null) return !r && event.createdAtLevel>=10 && state.monk?.ordinaryReplacementCredit===1;
  return Boolean(r?.kind==='long'&&['replacement-offer','replacement-edit'].includes(r.phase)&&
    event.restId===r.id&&event.createdAtLevel>=10&&state.monk.ordinaryReplacementCredit===1);
}
export function completeRest(s, request, derive, closeBattleBoundary) {
  const kind=request.kind;assert(['short','long'].includes(kind),'Rest kind required');
  const restId=text(request.restId,'rest ID');assert(typeof closeBattleBoundary==='function','Production boundary callback required');
  return recordedMutation(s,{id:request.id,kind:'rest',payload:{kind,restId}},d=>{
    runtime(d);
    assert(!hasPendingIncomingHp(d),'Resolve preceding incoming HP consequence first');
    const prior=d.monk.functionalRuntime.rest;
    const seenRest=Object.values(d.monk.functionalRuntime.operations).some(x=>x.kind==='rest'&&x.outcome?.restId===restId);
    assert((!prior||prior.id!==restId)&&!seenRest,'Rest ID already used');
    const boundary=closeBattleBoundary(d,kind);assert(boundary?.ok===true,'Combat boundary rejected');
    retireRestRights(d);
    const rt=d.monk.techniqueRuntime??={};
    const third=rt['ll-monk:awaken-the-third-eye'];
    if(third){third.awakenThirdEyePending=false;if(kind==='long')third.awakenThirdEyeActive=false;}
    const x=derive(d),level=integer(d.profile.level,1,20);
    d.combat.ki.current=integer(x.monk.kiMaximum);
    const turn=d.ui.turn;turn.actionUsed=false;turn.bonusActionUsed=false;turn.reactionUsed=false;
    for(const v of Object.values(rt)) if(plain(v)){
      if(v.cooldown==='short-rest'||kind==='long'&&v.cooldown==='long-rest')v.used=false;
      delete v.usedUntilRest;
    }
    delete rt.practicedUsedThisTurn;rt.deflectContinuation=null;
    d.ui.activeEffects=(d.ui.activeEffects??[]).filter(e=>
      e?.durationType!=='until-short-rest'&&!(kind==='long'&&e?.durationType==='until-long-rest'));
    if(kind==='long') {
      const before=integer(d.combat.hitDice.remaining,0,level);
      d.combat.hp.current=integer(x.maxHitPoints);d.combat.hp.temp=0;d.combat.concentration='';
      d.combat.practiced.current=integer(x.monk.practicedMaximum);
      d.combat.hitDice={...d.combat.hitDice,total:level,remaining:Math.min(level,before+Math.max(1,Math.floor(level/2)))};
      for(const spell of d.spellcasting?.racialSpells??[])if(spell.uses&&
        (spell.uses.refresh==='long-rest'||spell.id==='suggestion-2014'))spell.uses.current=integer(spell.uses.max);
    }
    const offer=kind==='long'&&level>=10;
    d.monk.functionalRuntime.rest={id:restId,kind,phase:kind==='short'?'hit-dice':offer?'replacement-offer':'finished',hitDiceSpent:0};
    if(offer){
      d.monk.replacementEntitlements??=[];
      const entitlementId='rest:'+restId;
      assert(!d.monk.replacementEntitlements.some(e=>e.id===entitlementId),'Entitlement ID already used');
      d.monk.replacementEntitlements.push({id:entitlementId,type:'rest',restId,createdAtLevel:level,consumed:false});
      d.monk.ordinaryReplacementCredit=1;
    }
    return {restId,kind,phase:d.monk.functionalRuntime.rest.phase,ki:d.combat.ki.current,hp:d.combat.hp.current,hitDice:d.combat.hitDice.remaining};
  });
}
export function spendHitDie(s, request, derive) {
  const restId=text(request.restId,'rest ID'),raw=integer(request.roll,1,100);
  return recordedMutation(s,{id:request.id,kind:'hit-die',payload:{restId,roll:raw}},d=>{
    const r=d.monk.functionalRuntime.rest;assert(r?.id===restId&&r.kind==='short'&&r.phase==='hit-dice','No active short-rest healing window');
    assert(!d.battleConsole?.current||d.battleConsole.current.phase==='ended','No hit-die healing during battle');
    const sides=integer(d.combat.hitDie,1,100);const roll=integer(raw,1,sides);
    const remaining=integer(d.combat.hitDice.remaining,0,integer(d.profile.level,1,20));assert(remaining>0,'No hit dice');
    const x=derive(d),max=integer(x.maxHitPoints),hp=integer(d.combat.hp.current,0,max);
    assert(hp<max,'HP full');const con=integer(x.abilityModifiers.constitution,-30,30);
    const healing=Math.max(0,roll+con);d.combat.hitDice.remaining=remaining-1;d.combat.hp.current=Math.min(max,hp+healing);r.hitDiceSpent++;
    return {restId,roll,constitutionModifier:con,healing,usefulHealing:d.combat.hp.current-hp,hpAfter:d.combat.hp.current,remaining:remaining-1};
  });
}
export function finishShortRest(s, request) {
  const restId=text(request.restId,'rest ID');
  return recordedMutation(s,{id:request.id,kind:'finish-short-rest',payload:{restId}},d=>{
    const r=d.monk.functionalRuntime.rest;assert(r?.id===restId&&r.kind==='short'&&r.phase==='hit-dice','No active healing window');
    r.phase='finished';return {restId,phase:r.phase};
  });
}
export function declineRestReplacement(s,request) {
  const restId=text(request.restId,'rest ID');
  return recordedMutation(s,{id:request.id,kind:'decline-rest-replacement',payload:{restId}},d=>{
    const r=d.monk.functionalRuntime.rest;assert(r?.id===restId&&r.kind==='long'&&['replacement-offer','replacement-edit'].includes(r.phase),'No current rest offer');
    const e=(d.monk.replacementEntitlements??[]).find(x=>x.restId===restId&&eligibleEntitlement(x,d));assert(e,'No eligible rest entitlement');
    e.declined=true;d.monk.ordinaryReplacementCredit=0;r.phase='finished';return {restId,declined:true};
  });
}
export function replaceRestTechnique(s,request,validateCandidate) {
  const p={restId:text(request.restId,'rest ID'),remove:text(request.remove,'removed technique'),add:text(request.add,'added technique')};
  assert(typeof validateCandidate==='function','Production selection validator required');
  return recordedMutation(s,{id:request.id,kind:'rest-replacement',payload:p},d=>{
    const r=d.monk.functionalRuntime.rest;assert(r?.id===p.restId,'Rest window unavailable');
    const e=(d.monk.replacementEntitlements??[]).find(x=>x.restId===p.restId&&eligibleEntitlement(x,d));assert(e,'No eligible rest entitlement');
    const list=d.monk.ordinaryTechniqueIds;assert(Array.isArray(list)&&list.filter(x=>x===p.remove).length===1,'Ordinary removed technique required');
    assert(p.remove!==p.add&&!list.includes(p.add)&&!Object.values(d.monk.signatureTechniqueSlots??{}).includes(p.add),'Duplicate or unchanged technique');
    const signatures=stable(d.monk.signatureTechniqueSlots??{}),choices=stable(d.monk.techniqueChoices??{});
    const candidate=clone(d);candidate.monk.ordinaryTechniqueIds[list.indexOf(p.remove)]=p.add;
    const verdict=validateCandidate(clone(candidate),{remove:p.remove,add:p.add,entitlement:clone(e)});
    assert(verdict?.ok===true,verdict?.reason??'Technique prerequisites rejected');
    assert(stable(candidate.monk.signatureTechniqueSlots??{})===signatures&&stable(candidate.monk.techniqueChoices??{})===choices,'Validator must not alter other selections');
    d.monk.ordinaryTechniqueIds=[...candidate.monk.ordinaryTechniqueIds];e.consumed=true;
    d.monk.replacementEvents??=[];d.monk.replacementEvents.push({id:e.id,type:'rest',consumed:true});
    d.monk.ordinaryReplacementCredit=0;r.phase='finished';return {...p,consumed:true};
  });
}
/** Call only INSIDE the same production transaction recording one real dart throw. */
export function spendBoundDart(draft,itemId) {
  const item=boundItem(draft,'darts',itemId);assert(item.quantity>0,'No darts');item.quantity--;return item.quantity;
}
export function gentlingPreview({extraKi,targetHp,sum,martialDieSides,wisdomModifier}) {
  const extra=integer(extraKi,0,integer(wisdomModifier,0,30)),sides=integer(martialDieSides,1,100),dice=5+extra;
  const rolled=integer(sum,dice,dice*sides),hp=integer(targetHp);
  return {cost:1+extra,dice,sides,sum:rolled,targetHp:hp,thresholdMet:hp<=rolled};
}
