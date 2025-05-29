(() => {
  'use strict';

  // ---------------- Konfiguration ----------------
  const BASE_HOUR   = 11;     // Start 11:00
  const SLOT_MIN    = 5;      // 5‑Minuten‑Raster
  const DEFAULT_UNITS = 12;   // 60 Minuten, wird dynamisch verlängert
  const MAX_UNITS   = 24;     // maximal bis 13:00 (120 Min.)

  // ---------------- DOM ----------------
  const tableBody       = document.querySelector('#wishTable tbody');
  const outputEl        = document.getElementById('output');
  // --------- Validation function: max 3 partners ---------
  function validatePartnerCount(){
    const rows = [...document.querySelectorAll('#wishTable tbody tr')];
    rows.forEach(r=>r.classList.remove('warningRow'));
    for(let i=0;i<rows.length;i++){
      const partners = rows[i]
          .querySelector('td:nth-child(2) input')
          .value.split(',')
          .map(p=>p.trim())
          .filter(Boolean);
      if(partners.length>3){
        rows[i].classList.add('warningRow');
        document.getElementById('output').textContent =
          `❌ Fehler in Zeile ${i+1}: mehr als 3 Partner angegeben.`;
        return false;
      }
    }
    return true;
  }

  const overviewEl      = document.getElementById('overview');
  const warnContainer   = document.createElement('p');
  warnContainer.className = 'warning';
  outputEl.parentNode.insertBefore(warnContainer, outputEl);

  const addRowBtn       = document.getElementById('addRowBtn');
  const computeBtn      = document.getElementById('computeBtn');
  const pdfBtn          = document.getElementById('downloadPdfBtn');
  const docBtn          = document.getElementById('downloadDocBtn');

  addRowBtn.addEventListener('click', addRow);
  computeBtn.addEventListener('click', compute);

  tableBody.addEventListener('click', e => {
    if (e.target.classList.contains('delete-row')) {
      e.target.closest('tr').remove();
    }
  });

  function addRow() {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input required placeholder="Requester"></td>' +
      '<td><input placeholder="Partner1,Partner2"></td>' +
      '<td><select><option value="5">5</option><option value="10">10</option></select></td>' +
      '<td><button type="button" class="delete-row">✕</button></td>';
    tableBody.appendChild(tr);
  }

  // ---------------- Planung ----------------
  function parseWishes() {
    const wishes = [];
    for (const row of tableBody.querySelectorAll('tr')) {
      const requester = row.cells[0].querySelector('input').value.trim();
      const partnersStr = row.cells[1].querySelector('input').value.trim();
      const duration = parseInt(row.cells[2].querySelector('select').value, 10);

      if (!requester) continue;

      const partners = partnersStr
        ? partnersStr.split(/\s*,\s*/).filter(Boolean)
        : [];
      if (partners.includes(requester)) {
        throw new Error('Requester darf nicht gleichzeitig Partner sein.');
      }
      if (partners.length === 0 || partners.length > 2) {
        throw new Error('Termine können maximal 3 Teilnehmende haben.');
      }
      wishes.push({ requester, partners, duration });
    }
    if (wishes.length === 0) {
      throw new Error('Keine gültigen Wünsche eingegeben.');
    }
    return wishes;
  }

  function compute(){
    if(!validatePartnerCount()) return;
    outputEl.textContent = '';
    overviewEl.textContent = '';
    warnContainer.textContent = '';
    pdfBtn.disabled = true;
    docBtn.disabled = true;

    try {
      const wishes  = parseWishes();
      const units   = MAX_UNITS; // plane zur Sicherheit 2 Stunden
      const schedule = solve(wishes, units);

      // --- Warnungen ---
      const warnMsgs = [];

      const lastEndUnit = Math.max(
        ...schedule.map(m => strToUnit(m.end))
      );
      if (lastEndUnit > DEFAULT_UNITS) {
        warnMsgs.push('Plan geht über 12:00 hinaus (endet um ' + unitToTime(lastEndUnit) + ').');
      }

      // Gesamtplan
      const planLines = schedule.map(m => `${m.start}–${m.end}: ${m.participants.join(', ')}`);
      outputEl.textContent = planLines.join('\n');

      // Übersicht pro Person
      const overviewLines = buildOverview(schedule);
      overviewEl.textContent = overviewLines;

      warnContainer.textContent = warnMsgs.join(' ');

      // Exporte aktivieren
      pdfBtn.disabled = false;
      docBtn.disabled = false;

      // Handler anhängen (nur einmal)
      if (!pdfBtn.dataset.bound) {
        pdfBtn.addEventListener('click', () => savePdf(planLines, overviewLines, warnMsgs));
        docBtn.addEventListener('click', () => saveDoc(planLines, overviewLines, warnMsgs));
        pdfBtn.dataset.bound = '1';
      }
    } catch (err) {
      warnContainer.textContent = err.message;
    }
  }

  // ---- Hilfsfunktionen ----
  function unitToTime(unit) {
    const minutes = unit * SLOT_MIN;
    const h = BASE_HOUR + Math.floor(minutes / 60);
    const m = minutes % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function strToUnit(timeStr) {
    const [h,m] = timeStr.split(':').map(Number);
    return (h - BASE_HOUR) * 60 / SLOT_MIN + m / SLOT_MIN;
  }

  function buildOverview(schedule) {
    const perPerson = {};
    schedule.forEach(m => {
      m.participants.forEach(p => {
        const partners = m.participants.filter(x => x !== p).join(', ');
        (perPerson[p] = perPerson[p] || []).push(
          `${m.start}–${m.end}: ${partners}`
        );
      });
    });
    return Object.keys(perPerson)
      .sort((a,b)=>a.localeCompare(b))
      .map(name => `${name}\n${perPerson[name].map(l=>'  • '+l).join('\n')}`)
      .join('\n\n');
  }

  // ---- Solver (Backtracking‑Greedy) ----
  function solve(wishes, totalUnits) {
    const groups    = wishes.map(w => [w.requester, ...w.partners].sort());
    const durations = wishes.map(w => w.duration / SLOT_MIN); // 1 oder 2
    const busy = Array.from({length: totalUnits}, () => new Set());
    const result = [];

    function fits(participants, start, len) {
      for (let t=start; t<start+len; t++){
        for(const p of participants){
          if(busy[t].has(p)) return false;
        }
      }
      return true;
    }
    function mark(participants, start, len, flag){
      for(let t=start; t<start+len; t++){
        for(const p of participants){
          flag?busy[t].add(p):busy[t].delete(p);
        }
      }
    }
    function backtrack(i){
      if(i===groups.length) return true;
      const len = durations[i];
      for(let start=0; start<=totalUnits-len; start++){
        if(fits(groups[i],start,len)){
          mark(groups[i],start,len,true);
          result.push({participants:groups[i], startUnit:start,endUnit:start+len});
          if(backtrack(i+1)) return true;
          result.pop();
          mark(groups[i],start,len,false);
        }
      }
      return false;
    }
    if(!backtrack(0)){
      throw new Error('Diese Wünsche passen selbst bei Verlängerung nicht.');
    }
    return result
      .sort((a,b)=>a.startUnit-b.startUnit)
      .map(m=>({
        participants:m.participants,
        start:unitToTime(m.startUnit),
        end:unitToTime(m.endUnit)
      }));
  }

  // ---- Exporte ----
  function savePdf(planLines, overviewLines, warnMsgs){
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({orientation:'portrait', unit:'mm', format:'a4'});
    let y=15;
    doc.setFontSize(16);
    doc.text('Team‑Tag Plan',10,y);
    y+=8;

    if(warnMsgs.length){
      doc.setTextColor(185,28,28);
      doc.setFontSize(11);
      doc.text('Warnungen:',10,y);
      y+=6;
      warnMsgs.forEach(w=>{
        doc.text('- '+w,12,y);
        y+=6;
      });
      doc.setTextColor(0,0,0);
      y+=2;
    }

    doc.setFontSize(12);
    doc.text('Gesamt‑Plan:',10,y); y+=6;
    doc.setFont('Courier','normal');
    planLines.forEach(line=>{
      if(y>280){doc.addPage();y=15;}
      doc.text(line,12,y); y+=6;
    });

    y+=6;
    doc.setFont('Helvetica','normal');
    doc.text('Übersicht pro Person:',10,y); y+=6;
    doc.setFont('Courier','normal');
    overviewLines.split(/\n/).forEach(line=>{
      if(y>280){doc.addPage();y=15;}
      doc.text(line,12,y); y+=6;
    });

    doc.save('team_tag_plan.pdf');
  }

  function saveDoc(planLines, overviewLines, warnMsgs){
    const htmlParts = [];
    if(warnMsgs.length){
      htmlParts.push('<p style="color:#b91c1c"><strong>Warnungen:</strong><br>'+warnMsgs.join('<br>')+'</p>');
    }
    htmlParts.push('<h2>Gesamt-Plan</h2><pre>'+planLines.join('\n')+'</pre>');
    htmlParts.push('<h2>Übersicht pro Person</h2><pre>'+overviewLines.replace(/\n/g,'<br/>')+'</pre>');
    const blob = new Blob(
      ['<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>'+htmlParts.join('')+'</body></html>'],
      {type:'application/msword'}
    );
    const link=document.createElement('a');
    link.href=URL.createObjectURL(blob);
    link.download='team_tag_plan.doc';
    link.click();
    URL.revokeObjectURL(link.href);
  }
})();

/* ----- Simple login overlay ----- */
document.addEventListener('DOMContentLoaded', ()=>{
  const overlay   = document.getElementById('loginOverlay');
  const pwInput   = document.getElementById('pwInput');
  const loginBtn  = document.getElementById('loginBtn');
  const loginMsg  = document.getElementById('loginMsg');

  function tryLogin(){
    if(pwInput.value === 'kjp2025'){
      overlay.style.display = 'none';
    }else{
      loginMsg.style.display = 'block';
      pwInput.value = '';
    }
  }

  loginBtn.addEventListener('click', tryLogin);
  pwInput.addEventListener('keydown', e=>{ if(e.key==='Enter') tryLogin(); });
});
