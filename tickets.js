'use strict';

const ticketLedger = (() => {
  const key = 'uma_lab_tickets_v1';
  const types = {'単勝':1,'複勝':1,'枠連':2,'馬連':2,'ワイド':2,'馬単':2,'三連複':3,'三連単':3};
  const labels = {pending:'結果待ち',hit:'的中',lost:'不的中',refund:'返還'};
  const yen = new Intl.NumberFormat('ja-JP', {style:'currency',currency:'JPY'});
  const el = id => document.getElementById(id);
  const isMoney = value => Number.isSafeInteger(value) && value > 0 && value % 100 === 0;
  let records = [];
  let readError = false;
  let activeRace;
  let editing;

  function numbersFor(type, value) {
    const [min, max] = type === '枠連' ? [1, 8] : [1, 18];
    const raw = value.normalize('NFKC').trim().split(/[\s,、‐‑‒–—−ー-]+/);
    const numbers = raw.map(Number);
    if (raw.length !== types[type] || raw.some(token => !/^\d+$/.test(token)) ||
        numbers.some(n => n < min || n > max) ||
        (type !== '枠連' && new Set(numbers).size !== numbers.length)) {
      throw Error(`${type}の番号を${types[type]}個入力してください。`);
    }
    if (!['馬単','三連単'].includes(type)) numbers.sort((a,b) => a-b);
    return numbers.join('-');
  }

  function validate(value) {
    if (!Array.isArray(value)) throw Error('馬券記録の形式が不正です。');
    const ids = new Set();
    for (const item of value) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
          !['raceId','raceName','date','venue'].every(field => typeof item[field] === 'string') ||
          !Object.hasOwn(types,item.type) || typeof item.numbers !== 'string' ||
          !Object.hasOwn(labels,item.status) || !isMoney(item.stake) ||
          !Number.isSafeInteger(item.payout) || item.payout < 0 ||
          (item.status === 'hit' && item.payout === 0) ||
          (item.status === 'refund' && item.payout !== item.stake) ||
          (['pending','lost'].includes(item.status) && item.payout !== 0)) {
        throw Error('馬券記録に不正な項目があります。');
      }
      numbersFor(item.type, item.numbers);
      ids.add(item.id);
    }
    return value;
  }

  function persist(next) {
    if (readError) throw Error('馬券記録を読み込めません。バックアップから復元してください。');
    localStorage.setItem(key, JSON.stringify(next));
    records = next;
  }

  function setStatus(message) {
    el('ticketStatus').textContent = message;
  }

  function resetForm() {
    editing = undefined;
    el('ticketForm').reset();
    el('ticketForm').hidden = !activeRace;
    el('ticketStake').value = 100;
    el('ticketSubmit').textContent = '購入を記録';
    el('ticketCancel').hidden = true;
    el('ticketRemove').hidden = true;
    updateFields();
  }

  function updateFields() {
    const result = el('ticketOutcome').value;
    el('ticketPayoutField').hidden = result !== 'hit';
    el('ticketPayout').required = result === 'hit';
    const type = el('ticketType').value;
    el('ticketNumbers').placeholder = ({1:'8',2:'6-8',3:'3-6-8'})[types[type]];
  }

  function edit(item) {
    editing = item;
    el('ticketType').value = item.type;
    el('ticketNumbers').value = item.numbers;
    el('ticketStake').value = item.stake;
    el('ticketOutcome').value = item.status;
    el('ticketPayout').value = item.status === 'hit' ? item.payout : '';
    el('ticketSubmit').textContent = '変更を保存';
    el('ticketCancel').hidden = false;
    el('ticketRemove').hidden = false;
    el('ticketForm').hidden = false;
    updateFields();
    el('ticketForm').scrollIntoView({block:'nearest'});
  }

  function paint() {
    const current = records.filter(item => item.raceId === activeRace?.raceId);
    const list = el('ticketList');
    list.replaceChildren();
    for (const item of current) {
      const row = document.createElement('div');
      row.className = 'ticket-row';
      const text = document.createElement('div');
      text.textContent = `${item.type} ${item.numbers} ｜ ${yen.format(item.stake)} ｜ ${labels[item.status]}${item.payout ? ' ' + yen.format(item.payout) : ''}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = '編集';
      button.onclick = () => edit(item);
      row.append(text, button);
      list.append(row);
    }
    if (!current.length) list.textContent = 'このレースの購入記録はまだありません。';

    const total = records.reduce((sum,item) => sum + item.stake,0);
    const settled = records.filter(item => ['hit','lost'].includes(item.status));
    const stake = settled.reduce((sum,item) => sum + item.stake,0);
    const payout = settled.reduce((sum,item) => sum + item.payout,0);
    const hits = settled.filter(item => item.status === 'hit').length;
    const pending = records.filter(item => item.status === 'pending').length;
    const refunded = records.length - settled.length - pending;
    const stats = [
      ['購入総額',yen.format(total)],
      ['確定払戻',yen.format(payout)],
      ['確定収支',yen.format(payout-stake)],
      ['回収率',stake ? (payout/stake*100).toFixed(1)+'%' : '—'],
      ['点数ベースの的中率',settled.length ? (hits/settled.length*100).toFixed(1)+'%' : '—']
    ];
    el('ticketStats').replaceChildren();
    for (const [label,value] of stats) {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      el('ticketStats').append(dt,dd);
    }
    el('ticketCount').textContent = `確定 ${settled.length}点（的中 ${hits}点）・結果待ち ${pending}点・返還 ${refunded}点`;
    const history = el('ticketHistory');
    history.replaceChildren();
    for (const item of [...records].sort((a,b) => b.date.localeCompare(a.date))) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'home-race';
      row.textContent = `${item.date} ${item.venue} ${item.raceName} ｜ ${item.type} ${item.numbers} ｜ ${yen.format(item.stake)} ｜ ${labels[item.status]}${item.payout ? ' ' + yen.format(item.payout) : ''}`;
      row.onclick = () => { openTicketRace(item.raceId); edit(item); };
      history.append(row);
    }
    if (!records.length) history.textContent = '購入記録はまだありません。';
  }

  function setup() {
    try {
      records = validate(JSON.parse(localStorage.getItem(key) ?? '[]'));
    } catch {
      readError = true;
      el('ticketCount').textContent = '馬券記録を読み込めませんでした。';
    }
    el('ticketType').onchange = updateFields;
    el('ticketOutcome').onchange = updateFields;
    el('ticketCancel').onclick = resetForm;
    el('ticketRemove').onclick = () => {
      if (!editing || !confirm('この購入記録を削除しますか？')) return;
      try {
        persist(records.filter(item => item.id !== editing.id));
        resetForm();
        paint();
        setStatus('購入記録を削除しました。');
      } catch (error) { setStatus(error.message); }
    };
    el('ticketForm').onsubmit = event => {
      event.preventDefault();
      try {
        const race = editing || activeRace;
        if (!race) throw Error('レースを選んでください。');
        const type = el('ticketType').value;
        const numbers = numbersFor(type, el('ticketNumbers').value);
        const stake = el('ticketStake').valueAsNumber;
        const status = el('ticketOutcome').value;
        const payout = status === 'hit' ? el('ticketPayout').valueAsNumber : status === 'refund' ? stake : 0;
        if (!isMoney(stake)) throw Error('購入額は100円単位で入力してください。');
        if (status === 'hit' && (!Number.isSafeInteger(payout) || payout <= 0)) throw Error('実際の払戻額を入力してください。');
        const item = {
          id: editing?.id ?? crypto.randomUUID(), raceId:race.raceId, raceName:race.raceName,
          date:race.date, venue:race.venue, type, numbers, stake, status, payout
        };
        persist(editing ? records.map(old => old.id === item.id ? item : old) : [...records,item]);
        resetForm();
        paint();
        setStatus('購入記録を保存しました。');
      } catch (error) { setStatus(error.message); }
    };
    resetForm();
    if (!readError) paint();
  }

  function selectRace(race) {
    const next = race ? {raceId:String(race.race_id),raceName:String(race.race_name || race.race_number + 'R'),
      date:String(race.date),venue:String(race.venue)} : undefined;
    if (activeRace?.raceId !== next?.raceId || editing) {
      resetForm();
      setStatus('');
    }
    activeRace = next;
    el('ticketForm').hidden = !race;
    if (!readError) paint();
  }

  return {key, setup, selectRace, validate, all:() => {
    if (readError) throw Error('馬券記録を読み込めなかったため、バックアップを作成できません。');
    return records;
  }, replaceInMemory(next) {
    readError = false;
    records = next;
    resetForm();
    paint();
  }};
})();
