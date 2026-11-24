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
  let manual = false;
  const todayParts = new Intl.DateTimeFormat('ja-JP',{
    timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date());
  const today = ['year','month','day'].map(part=>todayParts.find(x=>x.type===part).value).join('-');
  let month = today.slice(0,7);
  let selectedDay;
  const schedule = {
    '2026-11-28': {東京:{}, 京都:{9:'栂尾特別',10:'東山ステークス',11:'ラジオNIKKEI杯京都2歳ステークス'}},
    '2026-11-29': {
      東京:{8:'オリエンタル賞',9:'カトレアステークス',10:'アプローズ賞',11:'ウェルカムステークス',12:'ジャパンカップ'},
      京都:{9:'白菊賞',10:'花園ステークス',11:'オータムリーフステークス',12:'京阪杯'}
    }
  };

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
    manual = false;
    el('ticketRaceFields').hidden = true;
    for (const id of ['ticketDate','ticketVenue','ticketRaceNumber']) el(id).required = false;
    el('ticketForm').reset();
    el('ticketForm').hidden = !activeRace;
    el('ticketContext').textContent = activeRace ?
      `${activeRace.date} ${activeRace.venue} ${activeRace.raceName}` : '出馬表がなくても購入を記録できます。';
    el('ticketStake').value = 100;
    el('ticketSubmit').textContent = '購入を記録';
    el('ticketCancel').hidden = true;
    el('ticketRemove').hidden = true;
    updateFields();
  }

  function startManual() {
    resetForm();
    manual = true;
    el('ticketForm').hidden = false;
    el('ticketRaceFields').hidden = false;
    for (const id of ['ticketDate','ticketVenue','ticketRaceNumber']) el(id).required = true;
    el('ticketDate').value = today;
    el('ticketRaceNumber').value = '';
    updateSchedule();
    el('ticketContext').textContent = '出馬表なしの購入記録';
    setStatus('');
    el('ticketPanel').scrollIntoView({block:'start'});
  }

  function normalizedVenue() {
    return el('ticketVenue').value.replace(/\s/g,'').replace(/競馬場$/,'');
  }

  function updateSchedule() {
    const date = el('ticketDate').value;
    const venue = normalizedVenue();
    const venues = schedule[date];
    const buttons = el('ticketVenueOptions');
    buttons.replaceChildren();
    for (const name of Object.keys(venues || {})) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = name;
      button.onclick = () => { el('ticketVenue').value = name; updateSchedule(); };
      buttons.append(button);
    }
    for (const option of el('ticketRaceNumber').options) {
      if (!option.value) continue;
      const name = venues?.[venue]?.[option.value];
      option.textContent = option.value + 'R' + (name ? ' ' + name : '');
    }
    el('ticketScheduleNote').textContent = venues ? 'JRAの番組表（予定）から競馬場を選べます。地方競馬は競馬場を入力してください。' : '';
    el('ticketScheduleSource').href = venues ?
      'https://www.jra.go.jp/keiba/calendar2026/2026/11/' + date.slice(5).replace('-','') + '.html' :
      'https://www.jra.go.jp/keiba/program/2026/';
  }

  function manualRace() {
    const date = el('ticketDate').value;
    const venue = normalizedVenue();
    const raceNumber = Number(el('ticketRaceNumber').value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !venue ||
        !Number.isInteger(raceNumber) || raceNumber < 1 || raceNumber > 12) {
      throw Error('開催日・競馬場・レース番号を入力してください。');
    }
    const race = findTicketRace(date,venue,raceNumber);
    const name = race?.race_name || schedule[date]?.[venue]?.[raceNumber];
    return {date,venue,raceNumber,raceId:race ? String(race.race_id) : JSON.stringify([date,venue,raceNumber]),
      raceName:raceNumber + 'R' + (name ? ' ' + name : '')};
  }

  function updateFields() {
    const result = el('ticketOutcome').value;
    el('ticketPayoutField').hidden = result !== 'hit';
    el('ticketPayout').required = result === 'hit';
    const type = el('ticketType').value;
    el('ticketNumbers').placeholder = ({1:'8',2:'6-8',3:'3-6-8'})[types[type]];
  }

  function edit(item) {
    resetForm();
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
    const current = records.filter(item => item.raceId === activeRace?.raceId || (activeRace &&
      item.date === activeRace.date && item.venue === activeRace.venue && item.raceNumber === activeRace.raceNumber));
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

    paintMonth();
  }

  function moveMonth(offset) {
    const [year,number] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year,number-1+offset,1));
    month = date.toISOString().slice(0,7);
    selectedDay = undefined;
    paintMonth();
    el(offset < 0 ? 'ticketPreviousMonth' : 'ticketNextMonth').focus();
  }

  function paintCalendar(monthly) {
    const grid = el('ticketCalendar');
    grid.replaceChildren();
    const [year,number] = month.split('-').map(Number);
    el('ticketMonthTitle').textContent = `${year}年${number}月`;
    for (const label of ['日','月','火','水','木','金','土']) {
      const heading = document.createElement('span');
      heading.className = 'ticket-weekday';
      heading.textContent = label;
      grid.append(heading);
    }
    const start = new Date(Date.UTC(year,number-1,1)).getUTCDay();
    const length = new Date(Date.UTC(year,number,0)).getUTCDate();
    for (let slot=0; slot<start; slot++) {
      grid.append(document.createElement('span'));
    }
    const daily = new Map();
    for (const item of monthly) {
      daily.set(item.date,(daily.get(item.date) || 0)+item.stake);
    }
    for (let day=1; day<=length; day++) {
      const date = month+'-'+String(day).padStart(2,'0');
      const amount = daily.get(date);
      const cell = document.createElement(amount ? 'button' : 'span');
      cell.className = 'ticket-day';
      cell.textContent = day;
      if (date===today) cell.setAttribute('aria-current','date');
      if (amount) {
        cell.type = 'button';
        cell.dataset.date = date;
        cell.setAttribute('aria-label',`${number}月${day}日 購入 ${amount.toLocaleString('ja-JP')}円`);
        cell.setAttribute('aria-pressed',String(date===selectedDay));
        const price = document.createElement('small');
        price.textContent = amount.toLocaleString('ja-JP');
        cell.append(price);
        cell.onclick = () => {
          selectedDay = selectedDay===date ? undefined : date;
          paintMonth();
          grid.querySelector(`[data-date="${date}"]`)?.focus();
        };
      }
      grid.append(cell);
    }
  }

  function paintMonth() {
    const monthly = records.filter(item=>item.date.startsWith(month+'-'));
    paintCalendar(monthly);
    const total = monthly.reduce((sum,item) => sum + item.stake,0);
    const settled = monthly.filter(item => ['hit','lost'].includes(item.status));
    const stake = settled.reduce((sum,item) => sum + item.stake,0);
    const payout = settled.reduce((sum,item) => sum + item.payout,0);
    const hits = settled.filter(item => item.status === 'hit').length;
    const pending = monthly.filter(item => item.status === 'pending').length;
    const refunded = monthly.length - settled.length - pending;
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
    const visible = selectedDay ? monthly.filter(item=>item.date===selectedDay) : monthly;
    el('ticketClearDay').hidden = !selectedDay;
    el('ticketHistoryTitle').textContent = selectedDay ?
      Number(selectedDay.slice(-2)) + '日の購入履歴' : '月の購入履歴';
    const history = el('ticketHistory');
    history.replaceChildren();
    for (const item of [...visible].sort((a,b) => b.date.localeCompare(a.date))) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'home-race';
      row.textContent = `${item.date} ${item.venue} ${item.raceName} ｜ ${item.type} ${item.numbers} ｜ ${yen.format(item.stake)} ｜ ${labels[item.status]}${item.payout ? ' ' + yen.format(item.payout) : ''}`;
      row.onclick = () => { openTicketRace(item); edit(item); };
      history.append(row);
    }
    if (!visible.length) history.textContent = '購入記録はありません。';
  }

  function setup() {
    try {
      records = validate(JSON.parse(localStorage.getItem(key) ?? '[]'));
    } catch {
      readError = true;
      el('ticketCount').textContent = '馬券記録を読み込めませんでした。';
    }
    for (let number = 0; number <= 12; number++) {
      const option = document.createElement('option');
      option.value = number ? String(number) : '';
      option.textContent = number ? number + 'R' : '選択';
      el('ticketRaceNumber').append(option);
    }
    el('ticketPreviousMonth').onclick = () => moveMonth(-1);
    el('ticketNextMonth').onclick = () => moveMonth(1);
    el('ticketClearDay').onclick = () => {
      selectedDay = undefined;
      paintMonth();
      el('ticketMonthTitle').focus();
    };
    el('ticketDate').onchange = updateSchedule;
    el('ticketVenue').oninput = updateSchedule;
    el('ticketManual').onclick = startManual;
    el('ticketManualOverview').onclick = startManual;
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
        const race = editing || (manual ? manualRace() : activeRace);
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
          date:race.date, venue:race.venue, raceNumber:race.raceNumber, type, numbers, stake, status, payout
        };
        persist(editing ? records.map(old => old.id === item.id ? item : old) : [...records,item]);
        month = item.date.slice(0,7);
        selectedDay = undefined;
        if (manual) {
          el('ticketNumbers').value = '';
          el('ticketOutcome').value = 'pending';
          el('ticketPayout').value = '';
          updateFields();
        } else resetForm();
        paint();
        setStatus('購入記録を保存しました。');
      } catch (error) { setStatus(error.message); }
    };
    resetForm();
    if (!readError) paint();
  }

  function selectRace(race) {
    const next = race ? {raceId:String(race.race_id),raceName:String(race.race_number + 'R' + (race.race_name ? ' ' + race.race_name : '')),
      date:String(race.date),venue:String(race.venue).replace(/\s/g,'').replace(/競馬場$/,''),
      raceNumber:Number(race.race_number) || undefined} : undefined;
    if (activeRace?.raceId !== next?.raceId || editing || manual) {
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
