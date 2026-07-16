
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function htmlText(v,fallback=''){let s=String(v??'').trim();return escapeHtml(s||fallback)}
function jsString(v){return String(v??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' ')}
function safeClass(v){return String(v||'otherbank').replace(/[^a-z0-9_-]/gi,'')||'otherbank'}
const KEY='pesotrack2_real_foundation_v1';
const HERO_ACCOUNT_KEY='pesotrack2_home_focus_account';
function defaultCategories(){return ['Food','Groceries','Coffee','Dining','Transport','Gas','Parking','Shopping','Bills','Utilities','Rent','Internet','Phone','Health','Medicine','Insurance','Travel','Entertainment','Subscriptions','Education','Family','Pets','Gifts','Salary','Bonus','Freelance','Interest','Refund','Investment','Savings','Debt Payment','Credit Card','Transfer Fees','MP2','Other']}
function defaultPesoTrackData(){return {accounts:[],txns:[],bills:[],recurring:[],budgets:[],categories:defaultCategories(),categoryIcons:{},settings:{accent:'#6c63ff',privacy:false,weekStart:'1',currency:'PHP',dark:true,pinEnabled:false,pinHash:''}}}
function safeLoadData(){try{return JSON.parse(localStorage.getItem(KEY)||JSON.stringify(defaultPesoTrackData()))}catch(e){console.warn('PesoTrack storage unavailable. Using in-memory data for this session.',e);return defaultPesoTrackData()}}
let data=safeLoadData(),screen='dashboard',acctFilter='All',txnType='Expense',amount='0',txn={from:null,to:null,category:'Food',fee:0},editingAccount=null,settling=null,pickerMode=null,pickerField=null,reportPeriod='Month',editingTxn=null,editingRecurring=null,editingBudget=null,recurringDraftCategory='',settingsCategoryIcon='car';const banks={BPI:'bpi',BDO:'bdo',Metrobank:'metrobank',GCash:'gcash',Maya:'maya',HSBC:'hsbc',UnionBank:'unionbank',GoTyme:'gotyme',MariBank:'maribank',Maribank:'maribank',UnoBank:'uno',Unobank:'uno','MP2 Pag-IBIG':'mp2',COL:'bdo',ATRAM:'unionbank',Cash:'cash',Other:'otherbank'};function uid(){try{if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID()}catch(e){}return 'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)}function normalizeData(d){if(!d||typeof d!=='object')d={};if(!Array.isArray(d.recurring))d.recurring=[];if(!Array.isArray(d.accounts))d.accounts=[];if(!Array.isArray(d.txns))d.txns=[];if(!Array.isArray(d.bills))d.bills=[];if(!Array.isArray(d.budgets))d.budgets=[];if(!Array.isArray(d.categories))d.categories=defaultCategories();if(!d.categoryIcons||typeof d.categoryIcons!=='object')d.categoryIcons={};d.categories=[...new Set(defaultCategories().concat(d.categories).map(c=>String(c||'').trim()).filter(Boolean))];if(!d.settings||typeof d.settings!=='object')d.settings={accent:'#6c63ff',privacy:false,weekStart:'1',currency:'PHP',dark:true,pinEnabled:false,pinHash:''};if(!d.settings.accent)d.settings.accent='#6c63ff';if(!d.settings.weekStart)d.settings.weekStart='1';if(!d.settings.currency)d.settings.currency='PHP';d.settings.dark=true;d.settings.privacy=!!d.settings.privacy;d.settings.pinEnabled=!!d.settings.pinEnabled;d.settings.pinHash=d.settings.pinHash||'';return d}data=normalizeData(data);function peso(n){if(data.settings&&data.settings.privacy)return '\u2022\u2022\u2022\u2022';return '\u20b1'+Number(n||0).toLocaleString('en-PH',{maximumFractionDigits:2})}function persist(){try{localStorage.setItem(KEY,JSON.stringify(data))}catch(e){console.warn('PesoTrack could not persist to localStorage. Changes will remain for this session only.',e);if(typeof showToast==='function')showToast('Saved for this session. Use installed PWA for permanent storage.')}render()}const logoOptions=[{key:'bpi',name:'BPI',label:'BPI'},{key:'bdo',name:'BDO',label:'BDO'},{key:'metrobank',name:'Metrobank',label:'Metrobank'},{key:'unionbank',name:'UnionBank',label:'UnionBank'},{key:'maya',name:'Maya',label:'Maya'},{key:'gcash',name:'GCash',label:'GCash'},{key:'uno',name:'UnoBank',label:'UnoBank'},{key:'mp2',name:'MP2 Pag-IBIG',label:'MP2'},{key:'gotyme',name:'GoTyme',label:'GoTyme'},{key:'maribank',name:'MariBank',label:'MariBank'},{key:'hsbc',name:'HSBC',label:'HSBC'},{key:'cash',name:'Cash',label:'Cash'},{key:'otherbank',name:'',label:'Other',generic:true}];function bankIconSvg(){return '<svg viewBox="0 0 24 24" fill="none"><path d="M3 10.5 12 4l9 6.5M5 10.5V19h14v-8.5M9 19v-6h6v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'}function renderLogoPicker(selected){let el=document.getElementById('logoPickGrid');if(!el)return;el.innerHTML=logoOptions.map(o=>`<button type="button" class="logoSwatch ${o.key} ${o.key===selected?'active':''}" onclick="selectLogo('${o.key}')" aria-label="${o.generic?'Other, choose your own name':o.label}">${o.generic?`<span class="logoSwatchIcon">${bankIconSvg()}</span>`:`<span class="logoSwatchLabel">${o.label}</span>`}</button>`).join('')}function selectLogo(key){let f=document.getElementById('instLogo');if(!f)return;f.value=key;renderLogoPicker(key);let opt=logoOptions.find(o=>o.key===key);let instEl=document.getElementById('inst');if(instEl&&opt&&!opt.generic){instEl.value=opt.name}else if(instEl&&opt&&opt.generic){instEl.focus()}}function autoPickLogo(name){let f=document.getElementById('instLogo');if(!f)return;let n=String(name||'').trim().toLowerCase();if(!n)return;let foundKey=Object.keys(banks).find(k=>k.toLowerCase()===n);if(foundKey){let val=banks[foundKey];f.value=val;renderLogoPicker(val)}}function go(id,btn){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));if(btn&&!btn.classList.contains('fab'))btn.classList.add('active');screen=id;render()}function render(){
  const steps=[
    ['Accounts',renderAccounts],['Dashboard',renderDash],['Bills',renderBills],['Recurring',renderRecurring],
    ['Reports',renderReports],['Analytics',renderAnalytics],['Transactions',renderTransactionsList],
    ['GlobalSearch',renderGlobalSearch],['Insights',renderInsights],['Settings',renderSettings]
  ];
  for(const [name,fn] of steps){
    try{ if(typeof fn==='function') fn(); }
    catch(err){ console.error('Render step failed:',name,err); }
  }
}function daysUntil(dateStr){let today=new Date();today=new Date(today.getFullYear(),today.getMonth(),today.getDate());let d=new Date(dateStr);d=new Date(d.getFullYear(),d.getMonth(),d.getDate());return Math.ceil((d-today)/86400000)}
function todaysRange(){let start=new Date();start.setHours(0,0,0,0);let end=new Date(start);end.setDate(end.getDate()+1);return {start,end}}
function setQuickTransfer(){openTxn();setTxnType('Transfer',document.querySelector('#txnSheet .seg button:nth-child(3)'))}
function accountTotals(){
  const bank=data.accounts.filter(a=>a.type==='Savings').reduce((s,a)=>s+Number(a.balance||0),0);
  const cashHand=data.accounts.filter(a=>a.type==='Cash').reduce((s,a)=>s+Number(a.balance||0),0);
  const wallets=data.accounts.filter(a=>a.type==='Wallet').reduce((s,a)=>s+Number(a.balance||0),0);
  const investments=data.accounts.filter(a=>a.type==='Investment').reduce((s,a)=>s+Number(a.balance||0),0);
  const cards=data.accounts.filter(a=>a.type==='Credit Card').reduce((s,a)=>s+Number(a.outstanding||0),0);
  const liquid=bank+cashHand+wallets;
  const gross=liquid+investments;
  const netWorth=gross-cards;
  return {bank,cashHand,wallets,investments,cards,liquid,gross,netWorth};
}
function cashCategoryIcon(type){return {Savings:'BA',Cash:'CA',Wallet:'EW',Investment:'IN','Credit Card':'CC'}[type]||'AC'}
function renderDash(){let totals=accountTotals();let cash=totals.liquid;let cards=totals.cards;let unpaid=data.bills.filter(b=>b.status!=='Paid').slice().sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate));let due=unpaid.reduce((s,b)=>s+Number(b.remaining||b.amount||0),0);let safe=Math.max(0,cash-due);let nw=totals.netWorth;let netWorthEl=document.getElementById('netWorth');if(netWorthEl)netWorthEl.textContent=peso(nw);let bankEl=document.getElementById('bankTotal');if(bankEl)bankEl.textContent=peso(totals.bank);let cashHandEl=document.getElementById('cashHandTotal');if(cashHandEl)cashHandEl.textContent=peso(totals.cashHand);let walletEl=document.getElementById('walletTotal');if(walletEl)walletEl.textContent=peso(totals.wallets);if(typeof cashTotal!=='undefined')cashTotal.textContent=peso(cash);cardTotal.textContent=peso(cards);billsDue.textContent=peso(due);safeSpend.textContent=peso(safe);safeSpendHero.textContent=peso(safe);dashDate.textContent=new Date().toLocaleDateString('en-PH',{weekday:'long',month:'short',day:'numeric'});let tr=todaysRange(),todaySummary=summarizeTxns(txnsInRange(tr.start,tr.end));let todayTransfers=data.txns.filter(t=>{let d=new Date(t.date);return d>=tr.start&&d<tr.end&&t.type==='Transfer'}).reduce((s,t)=>s+Number(t.amount||0),0);let ti=document.getElementById('todayIncome'),te=document.getElementById('todayExpense'),tt=document.getElementById('todayTransfer'),tn=document.getElementById('todayNet');if(ti)ti.textContent=peso(todaySummary.income);if(te)te.textContent=peso(todaySummary.expense);if(tt)tt.textContent=peso(todayTransfers);if(tn)tn.textContent=peso(todaySummary.net);let focus=currentHeroAccount(),han=document.getElementById('heroAccountName'),haa=document.getElementById('heroAccountAmount');if(han&&haa){if(focus){han.textContent=focus.name||focus.institution||focus.type;haa.textContent=peso(accountAmount(focus))}else{han.textContent='Account';haa.textContent='Add one'}}let next=unpaid[0],d=next?daysUntil(next.dueDate):null;let dueToday=unpaid.filter(b=>daysUntil(b.dueDate)<=0).length;let tb=document.getElementById('todayBills');if(tb)tb.textContent=dueToday?`${dueToday} due today`:`${unpaid.length} due`;dashHealth.textContent=next?(d<0?'Overdue':d===0?'Due today':`Due in ${d}d`):'All clear';dashHealth.style.background=next?(d<=3?'#fff3e6':'#f0eeff'):'#ecfdf5';dashHealth.style.color=next?(d<=3?'var(--orange)':'var(--accent)'):'var(--green)';let h=typeof calculateHealth==='function'?calculateHealth():{score:0,label:'Ready',cur:{savingsRate:0},util:0};let hsd=document.getElementById('healthScoreDash');if(hsd)hsd.textContent=h.score||'--';let hld=document.getElementById('healthLabelDash');if(hld)hld.textContent=h.label||'Ready';let hsum=document.getElementById('healthSummaryDash');if(hsum)hsum.textContent=h.cur&&h.cur.income?`${h.cur.savingsRate}% savings rate this month.`:'Add income and expenses to unlock a better score.';let hs=document.getElementById('healthSavingsDash');if(hs)hs.textContent=h.cur&&h.cur.income?`${h.cur.savingsRate}%`:'--';let hu=document.getElementById('healthUtilDash');if(hu)hu.textContent=data.accounts.some(a=>a.type==='Credit Card')?`${h.util}%`:'--';if(typeof setHealthRing==='function')setHealthRing('healthRing',h.score||0);upcoming.innerHTML=unpaid.length?unpaid.slice(0,4).map(b=>{let dd=daysUntil(b.dueDate);let badge=dd<0?'Overdue':dd===0?'Today':`${dd} day${dd===1?'':'s'}`;return `<div class="premiumTimelineItem"><div class="premiumTimelineMain"><b>${b.cardName}</b><span>Due ${b.dueDate} - ${badge}</span></div><div class="premiumTimelineAmt">${peso(b.remaining)}</div></div>`}).join(''):'<div class="softEmpty">No unpaid bills. Credit card bills appear after card purchases.</div>';recent.innerHTML=recentTxns(data.txns).slice(0,5).map(t=>txnRow(t,true)).join('')||'<div class="row"><span class="sub">No transactions yet.</span></div>'}
function accountAmount(a){return Number(a&&a.type==='Credit Card'?a.outstanding:a.balance)||0}
function heroAccountList(){let accounts=(data.accounts||[]).filter(a=>a.type!=='Credit Card');return accounts.length?accounts:(data.accounts||[])}
function currentHeroAccount(){let list=heroAccountList();if(!list.length)return null;let saved=localStorage.getItem(HERO_ACCOUNT_KEY);return list.find(a=>a.id===saved)||list[0]}
function cycleHeroAccount(){let list=heroAccountList();if(!list.length){go('accounts',document.querySelectorAll('.nav button')[3]);return}let cur=currentHeroAccount(),i=Math.max(0,list.findIndex(a=>a.id===cur.id)),next=list[(i+1)%list.length];localStorage.setItem(HERO_ACCOUNT_KEY,next.id);renderDash();toastMsg(next.name||next.institution||'Account selected')}

function deleteTxn(id){
  const t=data.txns.find(x=>x.id===id);
  if(!t) return alert('Transaction not found.');
  const label=`${t.type||'Transaction'} ${peso(t.amount||0)}`;
  if(!confirm(`Delete ${label}? This will reverse the balance changes.`)) return;
  try{
    reverseTxn(t);
    data.txns=data.txns.filter(x=>x.id!==id);
    if(editingTxn===id){editingTxn=null;}
    persist();
    if(typeof showToast==='function') showToast('Transaction deleted');
  }catch(err){
    console.error('Delete transaction failed',err);
    alert('Unable to delete transaction. Details: '+(err&&err.message?err.message:err));
  }
}
function deleteEditingTxn(){
  if(!editingTxn) return alert('No transaction selected.');
  const id=editingTxn;
  deleteTxn(id);
  closeSheets();
}
function accountSubtitleLine(a){
  if(!a)return '';
  if(a.type==='Credit Card'){
    const limit=Number(a.limit||0), out=Number(a.outstanding||0), avail=Math.max(0,limit-out);
    const pct=limit?Math.min(100,Math.round(out/limit*100)):0;
    return `Outstanding - ${pct}% used - Available ${peso(avail)}`;
  }
  if(a.type==='Cash')return 'Cash on Hand';
  if(a.type==='Wallet')return 'E-Wallet';
  if(a.type==='Investment')return 'Investment';
  return a.institution||a.type||'Account';
}
function renderAccounts(){let arr=data.accounts.filter(a=>acctFilter==='All'||a.type===acctFilter);accountGrid.innerHTML=arr.map(a=>{try{return premiumAccountCard(a)}catch(e){console.error('Account card render failed',e,a);return `<div class="card" onclick="editAccount('${a.id}')">${logo(a)}<div class="name">${a.name||'Account'}</div><div class="inst">${a.institution||a.type||''}</div><div class="bal">${peso(a.type==='Credit Card'?a.outstanding:a.balance)}</div></div>`}}).join('')+`<div class="premiumAddCard" onclick="openAddAccount()"><div class="premiumAddIcon">+</div><div class="name">Add Account</div><div class="inst">Bank, cash, wallet, card, investment</div></div>`}function filterAccounts(f,el){acctFilter=f;document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');renderAccounts()}function billStatus(b){return b.remaining<=0?'Paid':(b.remaining<(b.amount||0)?'Partial':'Unpaid')}
function billPeriod(b){if(b.periodStart&&b.periodEnd)return `${b.periodStart} - ${b.periodEnd}`;let end=b.statementDate||'';let card=data.accounts.find(a=>a.id===b.cardId)||{};let sd=card.statementDay||new Date(end||Date.now()).getDate();let e=new Date(end||Date.now());let start=new Date(e.getFullYear(),e.getMonth()-1,sd+1);return `${start.toISOString().slice(0,10)} - ${end}`}
function shortStatementDate(d){let x=new Date(d);return isNaN(x)?String(d||''):x.toLocaleDateString('en-PH',{month:'short',day:'numeric'})}
function compactBillPeriod(b){let start=b.periodStart,end=b.periodEnd||b.statementDate;if(!start||!end){let card=data.accounts.find(a=>a.id===b.cardId)||{};let e=new Date(end||b.dueDate||Date.now());let sd=card.statementDay||e.getDate();start=new Date(e.getFullYear(),e.getMonth()-1,sd+1);end=end||e}return shortStatementDate(start)+' - '+shortStatementDate(end)}
function billPayments(b){return data.txns.filter(t=>t.type==='Card Payment'&&t.billId===b.id).sort((a,b)=>new Date(b.date)-new Date(a.date))}
function isoDate(d){return new Date(d).toISOString().slice(0,10)}
function displayDate(d){return new Date(d).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}
function nextStatementDate(card){let now=new Date();now.setHours(0,0,0,0);let day=Math.min(28,Math.max(1,Number(card.statementDay||1)));let st=new Date(now.getFullYear(),now.getMonth(),day);if(st<now)st=new Date(now.getFullYear(),now.getMonth()+1,day);return st}
function dueFromStatement(card,st){let dd=Math.min(28,Math.max(1,Number(card.dueDay||1)));return new Date(st.getFullYear(),st.getMonth()+(dd<=Number(card.statementDay||1)?1:0),dd)}
function daysUntilDate(d){let today=new Date();today.setHours(0,0,0,0);let x=new Date(d);x.setHours(0,0,0,0);return Math.ceil((x-today)/86400000)}
function statusClass(status){status=String(status||'Unpaid');return status==='Paid'?'paid':(status==='Partial'?'partial':'unpaid')}
function cardOpenBills(cardId){return data.bills.filter(b=>b.cardId===cardId&&billStatus(b)!=='Paid').sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate))}
function cardAllBills(cardId){return data.bills.filter(b=>b.cardId===cardId).sort((a,b)=>new Date(b.statementDate||b.dueDate)-new Date(a.statementDate||a.dueDate))}
function renderCreditCenter(){
  let el=document.getElementById('creditCenter');
  if(!el)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const billRows=(rows)=>rows&&rows.length?`<div class="ccStatementList">${rows.slice(0,4).map(b=>`<div class="ccStatementMini compactStatement"><div><b class="statementPeriod">${esc(compactBillPeriod(b))}</b><span class="sub">Due ${esc(displayDate(b.dueDate))}</span></div><div class="statementAmt"><b>${peso(b.remaining||0)}</b><span class="statusPill ${statusClass(billStatus(b))}">${billStatus(b)}</span></div></div>`).join('')}</div>`:'';
  const groupedBills={};
  (data.bills||[]).forEach(b=>{let key=b.cardId||b.cardName||'Card Statement';if(!groupedBills[key])groupedBills[key]=[];groupedBills[key].push(b)});
  Object.values(groupedBills).forEach(rows=>rows.sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)));
  let cards=(data.accounts||[]).filter(a=>a.type==='Credit Card');
  let virtualCards=Object.entries(groupedBills).filter(([key])=>!cards.some(a=>a.id===key)).map(([key,rows])=>{
    let open=rows.find(b=>billStatus(b)!=='Paid')||rows[0]||{};
    return {id:key,name:open.cardName||key||'Credit Card',institution:'Statement record',type:'Credit Card',limit:0,outstanding:rows.filter(b=>billStatus(b)!=='Paid').reduce((s,b)=>s+Number(b.remaining||0),0),_virtual:true,_bills:rows};
  });
  let allCards=cards.concat(virtualCards);
  if(!allCards.length){
    el.innerHTML='<div class="billSetupCard"><b>Credit Card Center needs a card account</b><p>Add or finish setting up a credit card account so statement dates, due dates, and settlement details can appear here.</p><button type="button" onclick="openAddCreditCard()">Add Credit Card</button></div>';
    return;
  }
  el.innerHTML=allCards.map(card=>{
    let rows=card._bills||groupedBills[card.id]||[];
    let nearest=rows.find(b=>billStatus(b)!=='Paid')||null;
    let statementDay=Number(card.statementDay||0), dueDay=Number(card.dueDay||0);
    let hasSchedule=statementDay&&dueDay&&!card._virtual;
    let st=hasSchedule?nextStatementDate(card):null;
    let due=hasSchedule?dueFromStatement(card,st):null;
    let out=Number(card.outstanding||0)||rows.filter(b=>billStatus(b)!=='Paid').reduce((s,b)=>s+Number(b.remaining||0),0);
    let limit=Number(card.limit||0), util=limit?Math.min(100,(out/limit)*100):0, avail=Math.max(0,limit-out);
    let dd=nearest?daysUntilDate(nearest.dueDate):(due?daysUntilDate(due):null);
    let dueText=nearest?`Due ${displayDate(nearest.dueDate)}`:(due?`Next due ${displayDate(due)}`:(card._virtual?'From statement records':'Add statement and due days'));
    let progClass=util>=80?'danger':util>=50?'warn':'';
    let pill=nearest?(dd<0?'Overdue':dd===0?'Due today':`${dd}d left`):(due?'No bill':(card._virtual?'Statement':'Setup needed'));
    let icon=card._virtual?'<div class="bank otherbank">CC</div>':logo(card);
    let primary=nearest?`<button class="primary" onclick="openSettle('${String(nearest.id).replace(/'/g,"\\'")}')">Settle</button>`:`<button class="primary" onclick="closeSheets();openTxn()">Add Purchase</button>`;
    let secondary=card._virtual?'<button onclick="openAddCreditCard()">Create Account</button>':`<button onclick="openAccountDetail('${String(card.id).replace(/'/g,"\\'")}')">${(!statementDay||!dueDay||!limit)?'Finish Setup':'Details'}</button>`;
    return `<div class="premiumCreditCard"><div class="premiumCreditHeader"><div class="premiumCreditLeft">${icon}<div style="min-width:0"><div class="premiumCreditTitle">${esc(card.name||'Credit Card')}</div><div class="premiumCreditSub ${(!statementDay||!dueDay||!limit)&&!card._virtual?'missing':''}">${esc(card.institution||'Credit Card')} - ${esc(dueText)}</div></div></div><span class="premiumDuePill ${dd===null?'':premiumDueClass(dd)}">${pill}</span></div><div class="premiumCreditBody"><div class="premiumCreditMain"><span>Outstanding</span><b>${peso(out)}</b><div class="premiumProgress ${progClass}" style="margin-top:12px"><i style="width:${util}%"></i></div><div class="premiumMetaRow" style="margin-top:9px"><span>${limit?util.toFixed(0)+'% used':'Limit missing'}</span><span>${limit?peso(avail)+' available':'Add limit'}</span></div></div><div class="premiumCreditSide"><div><span>Limit</span><b>${limit?peso(limit):'Add'}</b></div><div><span>Statement</span><b>${st?displayDate(st):(nearest?displayDate(nearest.statementDate||nearest.dueDate):'Add')}</b></div><div><span>Due day</span><b>${dueDay||'Add'}</b></div></div></div>${billRows(rows)}<div class="premiumCreditActions">${secondary}${primary}</div></div>`;
  }).join('');
}
function renderBills(){
  renderCreditCenter();
  let bills=(data.bills||[]).slice().sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate));
  bills.forEach(b=>b.status=billStatus(b));
  let current=bills.filter(b=>b.status!=='Paid'),history=bills.filter(b=>b.status==='Paid');
  billList.innerHTML=`<div class="statementSection"><h3>Current Statements</h3>${current.length?current.map(b=>renderBillCard(b)).join(''):'<div class="row"><span class="sub">No unpaid credit card statements.</span></div>'}</div><div class="statementSection"><h3>Statement History</h3>${history.length?history.slice().reverse().map(b=>renderBillCard(b,true)).join(''):'<div class="row"><span class="sub">Paid statements will appear here.</span></div>'}</div>`;
}
function txInPeriod(t,start,end){let d=new Date(t.date||Date.now());return d>=start&&d<end}
function groupAdd(obj,key,amt){obj[key]=(obj[key]||0)+Number(amt||0)}
function renderBars(income,expense,net){
  let el=document.getElementById('cashFlowBars');if(!el)return;
  let range=periodStartEnd(),anchor=new Date(range.start),buckets=[],period=reportPeriod;
  function addBucket(start,end,label){buckets.push({start,end,label,income:0,expense:0})}
  if(period==='Today'){
    for(let i=6;i>=0;i--){let s=new Date(anchor);s.setDate(s.getDate()-i);let e=new Date(s);e.setDate(e.getDate()+1);addBucket(s,e,s.toLocaleDateString('en-PH',{month:'short',day:'numeric'}))}
  }else if(period==='Week'){
    for(let i=6;i>=0;i--){let s=new Date(anchor);s.setDate(s.getDate()-(i*7));let e=new Date(s);e.setDate(e.getDate()+7);addBucket(s,e,s.toLocaleDateString('en-PH',{month:'short',day:'numeric'}))}
  }else if(period==='Year'){
    for(let i=4;i>=0;i--){let y=anchor.getFullYear()-i;addBucket(new Date(y,0,1),new Date(y+1,0,1),String(y))}
  }else{
    for(let i=5;i>=0;i--){let s=new Date(anchor.getFullYear(),anchor.getMonth()-i,1);let e=new Date(s.getFullYear(),s.getMonth()+1,1);addBucket(s,e,s.toLocaleDateString('en-PH',{month:'short'}))}
  }
  (data.txns||[]).forEach(t=>{
    let b=buckets.find(x=>txInPeriod(t,x.start,x.end));if(!b)return;
    let amt=Number(t.amount||0);
    if(t.type==='Income')b.income+=amt;
    else if(t.type==='Expense')b.expense+=amt;
    else if(t.type==='Transfer'&&Number(t.fee||0))b.expense+=Number(t.fee||0);
  });
  let max=Math.max(1,...buckets.flatMap(b=>[b.income,b.expense]));let barH=v=>v>0?Math.max(6,v/max*100):0;
  let best=buckets.reduce((a,b)=>((b.income-b.expense)>(a.income-a.expense)?b:a),buckets[0]||{income:0,expense:0,label:'-'});
  let worst=buckets.reduce((a,b)=>((b.expense-b.income)>(a.expense-a.income)?b:a),buckets[0]||{income:0,expense:0,label:'-'});
  el.innerHTML=`<div class="trendSummary"><div><span>Income</span><b class="green">${peso(income)}</b></div><div><span>Expense</span><b class="red">${peso(expense)}</b></div><div><span>Net</span><b class="${net>=0?'green':'red'}">${net>=0?'+':''}${peso(net)}</b></div></div><div class="trendLegend"><span><i class="income"></i>Income</span><span><i class="expense"></i>Expense</span></div><div class="periodTrendBars" style="grid-template-columns:repeat(${buckets.length},minmax(0,1fr))">${buckets.map(b=>`<div class="periodTrendBucket" title="${htmlText(b.label)} income ${peso(b.income)}, expense ${peso(b.expense)}"><div class="periodTrendPair"><i class="income" style="height:${barH(b.income)}%"></i><i class="expense" style="height:${barH(b.expense)}%"></i></div><span>${htmlText(b.label)}</span></div>`).join('')}</div><div class="trendNotes"><div><b>Best</b><span>${htmlText(best.label)} - ${peso(best.income-best.expense)}</span></div><div><b>Heaviest spend</b><span>${htmlText(worst.label)} - ${peso(worst.expense)}</span></div></div>`;
}
function txnTimestamp(t){let d=new Date(t&&t.date);return isNaN(d.getTime())?0:d.getTime()}
function recentTxns(list){return (list||[]).map((t,i)=>({t,i})).sort((a,b)=>(txnTimestamp(b.t)-txnTimestamp(a.t))||(b.i-a.i)).map(x=>x.t)}
function accountTxns(accountId){return recentTxns(data.txns.filter(t=>t.from===accountId||t.to===accountId))}
function accountStats(accountId){let income=0,expense=0,transferIn=0,transferOut=0,fees=0,payments=0;accountTxns(accountId).forEach(t=>{let amt=Number(t.amount||0),fee=Number(t.fee||0);if(t.type==='Income'&&t.from===accountId)income+=amt;else if(t.type==='Expense'&&t.from===accountId)expense+=amt;else if(t.type==='Transfer'){if(t.from===accountId){transferOut+=amt;fees+=fee}else if(t.to===accountId)transferIn+=amt}else if(t.type==='Card Payment'){if(t.from===accountId)payments+=amt; if(t.to===accountId)payments+=amt}});return {income,expense,transferIn,transferOut,fees,payments}}
function openAccountDetail(id){let a=data.accounts.find(x=>x.id===id);if(!a)return;let st=accountStats(id);let tx=accountTxns(id).slice(0,12);let main=a.type==='Credit Card'?Number(a.outstanding||0):Number(a.balance||0);let label=a.type==='Credit Card'?'Outstanding':'Current Balance';let statements=a.type==='Credit Card'?cardAllBills(a.id):[];let openBill=statements.find(b=>billStatus(b)!=='Paid');let nextSt=a.type==='Credit Card'?nextStatementDate(a):null;let nextDue=a.type==='Credit Card'?dueFromStatement(a,nextSt):null;let extra=a.type==='Credit Card'?`<div class="statBox"><span class="small">Credit Limit</span><b>${peso(a.limit||0)}</b></div><div class="statBox"><span class="small">Available</span><b>${peso((a.limit||0)-(a.outstanding||0))}</b></div><div class="statBox"><span class="small">Next Statement</span><b>${displayDate(nextSt)}</b></div><div class="statBox"><span class="small">Next Due</span><b>${openBill?displayDate(openBill.dueDate):displayDate(nextDue)}</b></div>`:`<div class="statBox"><span class="small">Income</span><b>${peso(st.income)}</b></div><div class="statBox"><span class="small">Expense</span><b>${peso(st.expense)}</b></div><div class="statBox"><span class="small">Transfers In</span><b>${peso(st.transferIn)}</b></div><div class="statBox"><span class="small">Transfers Out</span><b>${peso(st.transferOut+st.fees)}</b></div>`;let statementHtml=a.type==='Credit Card'?`<div class="section"><h2>Statement History</h2>${openBill?`<button class="ghost" onclick="openSettle('${openBill.id}')">Settle Current</button>`:''}</div><div class="statementList">${statements.length?statements.map(b=>`<div class="statementMini compactStatement"><div><b class="statementPeriod">${compactBillPeriod(b)}</b><div class="sub">Due ${displayDate(b.dueDate)}</div></div><div class="statementAmt"><b>${peso(b.remaining||0)}</b><span class="statusPill ${statusClass(billStatus(b))}">${billStatus(b)}</span></div></div>`).join(''):'<div class="emptyState">No statement history yet. Credit card purchases will create statement records automatically.</div>'}</div>`:'';accountDetailBody.innerHTML=`<section class="detailHero"><div class="detailTop">${logo(a)}<div><div class="name">${a.name}</div><div class="inst">${a.institution||a.type} - ${a.type}</div></div></div><div class="small" style="margin-top:14px">${label}</div><div class="detailAmount">${peso(main)}</div>${a.type==='Credit Card'?`<div class="bar"><i style="width:${Math.min(100,((a.outstanding||0)/(a.limit||1))*100)}%"></i></div>`:''}</section><div class="statGrid">${extra}</div><div class="sheetActions"><button class="primary" onclick="closeSheets();editAccount('${a.id}')">Edit Account</button><button onclick="closeSheets();openTxn()">Add Transaction</button></div><button class="dangerBtn" onclick="deleteAccountById('${a.id}')">Delete Account</button>${statementHtml}<div class="section"><h2>Recent Activity</h2></div><div class="detailList">${tx.length?tx.map(t=>txnRow(t,true)).join(''):'<div class="emptyState">No activity yet for this account.</div>'}</div>`;showModal();accountDetailSheet.classList.add('show')}


let searchFilter='All';
function setSearchFilter(f,el){searchFilter=f;document.querySelectorAll('.searchTabs button').forEach(b=>b.classList.remove('active'));if(el)el.classList.add('active');renderGlobalSearch()}
function resultIcon(kind,type){if(kind==='acct')return 'AC';if(kind==='bill')return 'DU';if(type==='Income')return 'IN';if(type==='Expense')return 'EX';if(type==='Transfer')return 'TR';return 'TX'}
function renderGlobalSearch(){let out=document.getElementById('globalSearchResults');if(!out)return;let input=document.getElementById('globalSearchInput'),q=(input?.value||'').toLowerCase().trim();let results=[];if(searchFilter==='All'||searchFilter==='Transactions'){data.txns.slice().reverse().forEach(t=>{let from=accountLabel(t.from),to=t.to?accountLabel(t.to):'',date=new Date(t.date).toLocaleDateString('en-PH'),hay=[t.type,t.category,t.note,from,to,peso(t.amount),date].join(' ').toLowerCase();if(!q||hay.includes(q))results.push({kind:'txn',type:t.type,title:`${t.type}${t.category?' - '+t.category:''}`,sub:`${from}${to?' to '+to:''} - ${date}${t.note?' - '+t.note:''}`,amount:Number(t.amount||0),id:t.id})})}if(searchFilter==='All'||searchFilter==='Accounts'){data.accounts.forEach(a=>{let hay=[a.name,a.institution,a.type,peso(a.balance),peso(a.outstanding)].join(' ').toLowerCase();if(!q||hay.includes(q))results.push({kind:'acct',title:a.name,sub:`${a.institution||a.type} - ${a.type}`,amount:a.type==='Credit Card'?Number(a.outstanding||0):Number(a.balance||0),id:a.id})})}if(searchFilter==='All'||searchFilter==='Bills'){data.bills.slice().sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)).forEach(b=>{let hay=[b.cardName,b.status,b.dueDate,peso(b.remaining)].join(' ').toLowerCase();if(!q||hay.includes(q))results.push({kind:'bill',title:b.cardName,sub:`Due ${b.dueDate} - ${billStatus(b)}`,amount:Number(b.remaining||0),id:b.id})})}results=results.slice(0,!q&&searchFilter==='All'?15:40);out.innerHTML=results.length?results.map(r=>`<div class="resultCard"><div class="resultLeft"><div class="dot">${resultIcon(r.kind,r.type)}</div><div class="resultText"><b>${htmlText(r.title)}</b><div class="sub">${htmlText(r.sub)}</div></div></div><b class="${r.kind==='txn'&&r.type==='Income'?'green':r.kind==='txn'&&r.type==='Expense'?'red':''}">${peso(r.amount)}</b></div>`).join(''):`<div class="emptyCenter">${q?'No results found.':'Start typing to search your PesoTrack data.'}</div>`}

function renderReports(){let {start,end}=periodStartEnd(),acct=(document.getElementById('reportAccount')||{}).value||'All';let txns=data.txns.filter(t=>txInPeriod(t,start,end)).filter(t=>acct==='All'||t.from===acct||t.to===acct);let income=0,expense=0,cats={},sources={},activity={};txns.forEach(t=>{let amt=Number(t.amount||0);if(t.type==='Income'){if(acct==='All'||t.from===acct){income+=amt;groupAdd(sources,t.category||accountLabel(t.from),amt);groupAdd(activity,accountLabel(t.from),amt)}}else if(t.type==='Expense'){if(acct==='All'||t.from===acct){expense+=amt;groupAdd(cats,t.category||'Other',amt);groupAdd(activity,accountLabel(t.from),-amt)}}else if(t.type==='Transfer'){let fee=Number(t.fee||0);if(fee&&(acct==='All'||t.from===acct)){expense+=fee;groupAdd(cats,'Transfer Fees',fee)}if(acct!=='All'){if(t.from===acct)groupAdd(activity,accountLabel(t.from),-(amt+fee));if(t.to===acct)groupAdd(activity,accountLabel(t.to),amt)}}else if(t.type==='Card Payment'){if(acct!=='All'){if(t.from===acct)groupAdd(activity,accountLabel(t.from),-amt);if(t.to===acct)groupAdd(activity,accountLabel(t.to),amt)}}});let net=income-expense;let reportIncomeEl=document.getElementById('reportIncome'),reportExpenseEl=document.getElementById('reportExpense'),reportNetEl=document.getElementById('reportNet');if(reportIncomeEl)reportIncomeEl.textContent=peso(income);if(reportExpenseEl)reportExpenseEl.textContent=peso(expense);if(reportNetEl){reportNetEl.textContent=(net>=0?'+':'')+peso(net);reportNetEl.className='value '+(net>=0?'green':'red')}renderBars(income,expense,net);renderReportList('categoryReport',cats,'cat');renderReportList('incomeReport',sources,'income');let acctObj={};Object.entries(activity).forEach(([k,v])=>acctObj[k]=v);renderReportList('accountReport',acctObj,'acct')}function showModal(){modalBackdrop.classList.add('show');document.body.classList.add('modal-open')}function hideModalIfNone(){setTimeout(()=>{if(!document.querySelector('.sheet.show')){modalBackdrop.classList.remove('show');document.body.classList.remove('modal-open')}},0)}function closeTopModal(){let sheets=[...document.querySelectorAll('.sheet.show')];if(!sheets.length)return;let top=sheets[sheets.length-1];top.classList.remove('show');hideModalIfNone()}function closeSheets(){document.querySelectorAll('.sheet').forEach(s=>s.classList.remove('show'));modalBackdrop.classList.remove('show');document.body.classList.remove('modal-open')}function openAddAccount(){editingAccount=null;acctTitle.textContent='Add Account';atype.value='Savings';inst.value='';aname.value='';let lf=document.getElementById('instLogo');if(lf){lf.value='otherbank';lf.dataset.manual=''}renderAccountFields();renderLogoPicker('otherbank');showModal();accountSheet.classList.add('show')}function editAccount(id){let a=data.accounts.find(x=>x.id===id); if(!a)return; editingAccount=id; acctTitle.textContent='Edit Account';atype.value=a.type;inst.value=a.institution||'';aname.value=a.name;let key=a.logoKey||banks[a.institution]||'otherbank';let lf=document.getElementById('instLogo');if(lf){lf.value=key;lf.dataset.manual='1'}renderAccountFields(a);renderLogoPicker(key);showModal();accountSheet.classList.add('show')}function renderAccountFields(a={}){let t=atype.value;if(document.getElementById('inst')){inst.style.display=t==='Cash'?'none':''; if(t==='Cash') inst.value='';} if(t==='Cash' && document.getElementById('aname') && !aname.value) aname.value='Cash on Hand';dynamicFields.innerHTML=t==='Credit Card'?`<input class="field" id="limit" type="number" placeholder="Credit limit" value="${a.limit||''}"><input class="field" id="statementDay" type="number" placeholder="Statement day, e.g. 15" value="${a.statementDay||''}"><input class="field" id="dueDay" type="number" placeholder="Due day, e.g. 5" value="${a.dueDay||''}"><button class="ghost" onclick="deleteAccount()">Delete</button>`:`<input class="field" id="balance" type="number" placeholder="${t==='Investment'?'Current value':'Opening balance'}" value="${a.balance||''}"><button class="ghost" onclick="deleteAccount()">Delete</button>`}function saveAccount(){
  try{
    const typeEl=document.getElementById('atype'), instEl=document.getElementById('inst'), nameEl=document.getElementById('aname');
    if(!typeEl) throw new Error('Account type field is missing');
    if(!nameEl) throw new Error('Account name field is missing');
    let t=typeEl.value||'Savings';
    let existing=data.accounts.find(x=>x.id===editingAccount);
    let a=existing||{id:uid(),outstanding:0,balance:0};
    a.type=t;
    a.institution=t==='Cash'?'Cash':(instEl&&instEl.value&&instEl.value.trim()?instEl.value.trim():'Other');
    a.name=(nameEl.value||'').trim() || (t==='Cash'?'Cash on Hand':(a.institution||t));
    a.logoKey=(document.getElementById('instLogo')||{}).value||undefined;

    if(t==='Credit Card'){
      const limitEl=document.getElementById('limit'), sdEl=document.getElementById('statementDay'), ddEl=document.getElementById('dueDay');
      const lim=Number(limitEl&&limitEl.value!==''?limitEl.value:0);
      const sd=Number(sdEl&&sdEl.value!==''?sdEl.value:1);
      const dd=Number(ddEl&&ddEl.value!==''?ddEl.value:1);
      if(!Number.isFinite(lim) || lim < 0) throw new Error('Credit limit must be a valid number');
      if(!Number.isFinite(sd) || sd < 1 || sd > 31) throw new Error('Statement day must be 1 to 31');
      if(!Number.isFinite(dd) || dd < 1 || dd > 31) throw new Error('Due day must be 1 to 31');
      a.limit=lim;
      a.statementDay=Math.min(28,Math.max(1,sd));
      a.dueDay=Math.min(28,Math.max(1,dd));
      a.balance=0;
      a.outstanding=Number(a.outstanding||0);
    }else{
      const balEl=document.getElementById('balance');
      const bal=Number(balEl&&balEl.value!==''?balEl.value:0);
      if(!Number.isFinite(bal)) throw new Error('Opening balance must be a valid number');
      a.balance=bal;
      delete a.limit; delete a.statementDay; delete a.dueDay;
      a.outstanding=0;
    }

    if(!existing)data.accounts.push(a);
    try{ localStorage.setItem(KEY,JSON.stringify(data)); }
    catch(storageErr){ console.warn('LocalStorage save failed; keeping session data only.',storageErr); }

    acctFilter='All';
    document.querySelectorAll('.chip').forEach((c,i)=>c.classList.toggle('active',i===0));
    closeSheets();
    go('accounts',document.querySelectorAll('.nav button')[1]);
    if(typeof showToast==='function')showToast(existing?'Account updated':'Account saved');
  }catch(err){
    console.error('Save account failed:',err);
    alert('Unable to save account. Details: '+(err&&err.message?err.message:String(err)));
  }
}
function deleteAccountById(id){
  const a=data.accounts.find(x=>x.id===id); if(!a)return;
  const related=data.txns.filter(t=>t.from===id||t.to===id).length;
  let msg=`Delete ${a.name||'this account'}?`+(related?`\n\nThis account has ${related} related transaction${related===1?'':'s'}. The transactions will stay in history but will show as Deleted Account.`:'');
  if(confirm(msg)){
    data.accounts=data.accounts.filter(x=>x.id!==id);
    if(editingAccount===id)editingAccount=null;
    persist();
    closeSheets();
    acctFilter='All';
    document.querySelectorAll('.chip').forEach((c,i)=>c.classList.toggle('active',i===0));
    go('accounts',document.querySelectorAll('.nav button')[1]);
    if(typeof showToast==='function')showToast('Account deleted');
  }
}
function deleteAccount(){if(!editingAccount)return closeSheets(); deleteAccountById(editingAccount)}function txnInputDateValue(v){let d=v?new Date(v):new Date();if(isNaN(d.getTime()))d=new Date();let offset=d.getTimezoneOffset()*60000;return new Date(d.getTime()-offset).toISOString().slice(0,10)}function txnIsoFromInput(v,fallback){let day=v||txnInputDateValue(fallback);let d=new Date(day+'T12:00:00');if(isNaN(d.getTime()))d=new Date();return d.toISOString()}function openTxn(id){editingTxn=id||null;let old=editingTxn?data.txns.find(t=>t.id===editingTxn):null;if(old&&old.type==='Card Payment'){alert('Card payments are edited from the bill settlement flow. You can delete it from the transaction list if needed.');editingTxn=null;return}amount=old?String(old.amount||0):'0';txnType=old?old.type:'Expense';txn={from:old?.from||null,to:old?.to||null,category:old?.category||'Food',fee:Number(old?.fee||0),note:old?.note||''};txnTitle.textContent=old?'Edit Transaction':'Add Transaction';txnSaveBtn.textContent=old?'Update Transaction':'Save Transaction';txnDeleteBtn.classList.toggle('hide',!old);document.querySelectorAll('#txnSheet .seg button').forEach(b=>b.classList.toggle('active',b.textContent.trim()===txnType));renderTxn();if(document.getElementById('txnNote')){txnNote.value=txn.note||'';toggleTxnNote(!!txn.note)}let dateEl=document.getElementById('txnDate');if(dateEl)dateEl.value=txnInputDateValue(old?.date||Date.now());showModal();txnSheet.classList.add('show')}function setTxnType(t,el){txnType=t;document.querySelectorAll('#txnSheet .seg button').forEach(b=>b.classList.remove('active'));if(el)el.classList.add('active');if(t==='Income'&&(!txn.category||txn.category==='Food'))txn.category='Salary';if(t==='Expense'&&(!txn.category||txn.category==='Salary'))txn.category='Food';if(t==='Transfer')txn.category='';renderTxn()}function accountById(id){return data.accounts.find(a=>a.id===id)}
function accountPickButton(field,label,wide=false){let a=accountById(txn[field]);if(!a)return `<button class="txnPickBtn ${wide?'wide':''}" onclick="chooseAcct('${field}')"><div class="catCircle">+</div><div class="txnPickText"><b>${label}</b><span>Choose account</span><em>Pick from accounts you added</em></div></button>`;let main=a.name||a.institution||a.type,sub=`${a.institution||a.type} - ${a.type==='Credit Card'?'Outstanding '+peso(a.outstanding||0):'Balance '+peso(a.balance||0)}`;return `<button class="txnPickBtn ${wide?'wide':''}" onclick="chooseAcct('${field}')">${logo(a)}<div class="txnPickText"><b>${label}</b><span>${main}</span><em>${sub}</em></div></button>`}
function categoryPickButton(label,wide=false){let c=txn.category||'Choose category';return `<button class="txnPickBtn ${wide?'wide':''}" onclick="chooseCat()"><div class="catCircle">${catIcon(c)}</div><div class="txnPickText"><b>${label}</b><span>${c}</span><em>${txnType==='Income'?'Income source':'Expense category'}</em></div></button>`}
function renderTxn(){if(txnType==='Transfer')txnPick.innerHTML=accountPickButton('from','From Account')+accountPickButton('to','To Account')+feeInput();else if(txnType==='Income')txnPick.innerHTML=accountPickButton('from','Deposit To')+categoryPickButton('Source');else txnPick.innerHTML=accountPickButton('from','Account')+categoryPickButton('Category');updateAmountDisplay();pad.innerHTML=['7','8','9','4','5','6','1','2','3','.','0','backspace'].map(x=>`<button type="button" class="${x==='backspace'?'backspace':''}" aria-label="${x==='backspace'?'Delete last digit':x==='.'?'Decimal point':'Number '+x}" onclick="tap('${x}')">${x==='backspace'?'<span aria-hidden="true">Del</span>':x}</button>`).join('')}function feeInput(){return `<label class="feeBox"><div><b>Transfer Fee</b><span>Optional fee charged by bank/wallet</span></div><input id="transferFee" type="number" min="0" step="0.01" value="${Number(txn.fee||0)||''}" placeholder="0" oninput="txn.fee=Number(this.value||0)"></label>`}function name(id){return (data.accounts.find(a=>a.id===id)||{}).name}function displayInputAmount(v){if(data.settings&&data.settings.privacy)return '\u2022\u2022\u2022\u2022';let s=String(v||'0');if(s.includes('.')){let parts=s.split('.'),whole=parts[0]||'0',dec=(parts[1]||'').slice(0,2);return '\u20b1'+Number(whole||0).toLocaleString('en-PH')+'.'+dec}return peso(s)}function updateAmountDisplay(){if(document.getElementById('amtDisplay'))amtDisplay.textContent=displayInputAmount(amount)}function cleanAmountInput(v){let s=String(v||'0').replace(/[^\d.]/g,'');let firstDot=s.indexOf('.');if(firstDot>-1){s=s.slice(0,firstDot+1)+s.slice(firstDot+1).replace(/\./g,'');let parts=s.split('.');parts[1]=(parts[1]||'').slice(0,2);s=parts[0]+'.'+parts[1]}s=s.replace(/^0+(?=\d)/,'');return s||'0'}function toggleTxnNote(force){let input=document.getElementById('txnNote'),btn=document.getElementById('txnNoteToggle');if(!input)return;let open=force===undefined?input.classList.contains('collapsed'):!!force;input.classList.toggle('collapsed',!open);if(btn)btn.textContent=open?'Hide Note':'+ Note';if(open)setTimeout(()=>input.focus(),0)}function tap(x){if(x==='backspace')amount=amount.length>1?amount.slice(0,-1):'0';else if(x==='.'&&!amount.includes('.'))amount=amount==='0'?'0.':amount+'.';else if(x!=='.'){let parts=String(amount).split('.');if(parts.length>1&&parts[1].length>=2)return;amount=amount==='0'?x:amount+x}amount=cleanAmountInput(amount);updateAmountDisplay()}function accountSubtitle(a){
  if(!a)return '';
  if(a.type==='Credit Card'){
    let avail=Number(a.limit||0)-Number(a.outstanding||0);
    return `Outstanding ${peso(a.outstanding||0)} - Available ${peso(avail)}`;
  }
  return `${a.type} - Balance ${peso(a.balance||0)}`;
}
function closePicker(){pickerSheet.classList.remove('show');pickerSheet.classList.remove('compactCategoryPicker');pickerMode=null;pickerField=null;pickerSearch.value='';hideModalIfNone()}
function chooseAcct(field){
  pickerSheet.classList.remove('compactCategoryPicker');pickerMode='account';pickerField=field;pickerTitle.textContent=field==='to'?'Choose To Account':(txnType==='Income'?'Choose Deposit Account':'Choose Account');pickerSub.textContent='Only accounts you added are shown';pickerSearch.value='';renderPicker();showModal();pickerSheet.classList.add('show')
}
function chooseCat(){
  pickerSheet.classList.add('compactCategoryPicker');pickerMode='category';pickerField='category';pickerTitle.textContent=txnType==='Income'?'Choose Income Source':'Choose Category';pickerSub.textContent=txnType==='Income'?'Tap the source of income':'Tap a category';pickerSearch.value='';renderPicker();showModal();pickerSheet.classList.add('show')
}
function chooseRecurringCat(){
  let type=document.getElementById('recType')?.value||'Expense';
  pickerSheet.classList.add('compactCategoryPicker');
  pickerMode='recurringCategory';
  pickerField='recCategory';
  pickerTitle.textContent=type==='Income'?'Choose Income Source':'Choose Category';
  pickerSub.textContent=type==='Income'?'Tap the source of income':'Tap a category';
  pickerSearch.value='';
  renderPicker();
  showModal();
  pickerSheet.classList.add('show')
}
function renderPicker(){
  const q=(pickerSearch.value||'').toLowerCase().trim();
  if(pickerMode==='account'){
    let accounts=data.accounts.slice();
    if(txnType==='Income') accounts=accounts.filter(a=>a.type!=='Credit Card');
    if(txnType==='Transfer' && pickerField==='to' && txn.from) accounts=accounts.filter(a=>a.id!==txn.from);
    if(txnType==='Transfer' && pickerField==='from' && txn.to) accounts=accounts.filter(a=>a.id!==txn.to);
    if(q) accounts=accounts.filter(a=>`${a.name} ${a.institution} ${a.type}`.toLowerCase().includes(q));
    pickerList.innerHTML=accounts.length?accounts.map(a=>`<button class="option" onclick="selectAccount('${a.id}')">${logo(a)}<div style="flex:1"><b>${a.name}</b><div class="meta">${a.institution||a.type}</div><div class="minirow"><span>${a.type==='Credit Card'?'Card':'Account'}</span><span>${accountSubtitle(a)}</span></div></div></button>`).join(''):`<div class="empty">No accounts yet. Add an account first from the Accounts tab.</div>`;
  }else if(pickerMode==='category'||pickerMode==='recurringCategory'){
    let cats=categoryListForTxn();
    if(q) cats=cats.filter(c=>c.toLowerCase().includes(q));
    let exact=(data.categories||[]).some(c=>c.toLowerCase()===q);
    let add=q&&!exact?`<button class="categoryCompactChip categoryCreate" onclick="selectCategory('${jsString(pickerSearch.value.trim())}')"><span class="catMiniIcon">+</span><b>Add "${htmlText(pickerSearch.value.trim())}"</b></button>`:'';
    let chips=add+cats.map(c=>`<button class="categoryCompactChip" onclick="selectCategory('${jsString(c)}')"><span class="catMiniIcon">${catIcon(c)}</span><b>${htmlText(c)}</b></button>`).join('');
    pickerList.innerHTML=chips?`<div class="categoryCompactGrid">${chips}</div>`:'<div class="empty">Type a category name to add it.</div>';  }
}
function categoryListForTxn(){let mode=pickerMode==='recurringCategory'?(document.getElementById('recType')?.value||'Expense'):txnType;let preferred=mode==='Income'?['Salary','Bonus','Freelance','Interest','Refund','Investment','Other']:['Food','Groceries','Coffee','Dining','Transport','Gas','Parking','Shopping','Bills','Utilities','Rent','Internet','Phone','Health','Medicine','Insurance','Travel','Entertainment','Subscriptions','Education','Family','Pets','Gifts','Debt Payment','Credit Card','Transfer Fees','MP2','Other'];let saved=(data.categories||[]);return [...new Set(preferred.concat(saved).map(c=>String(c||'').trim()).filter(Boolean))]}
function categoryCode(c){const map={Food:'FD',Groceries:'GR',Coffee:'CF',Dining:'DN',Transport:'TR',Gas:'GS',Parking:'PK',Shopping:'SH',Bills:'BL',Utilities:'UT',Rent:'RN',Internet:'IN',Phone:'PH',Health:'HL',Medicine:'MD',Insurance:'IS',Travel:'TV',Entertainment:'EN',Subscriptions:'SB',Education:'ED',Family:'FM',Pets:'PT',Gifts:'GF',Salary:'PY',Bonus:'BN',Freelance:'FL',Interest:'IT',Refund:'RF',Investment:'IV',Savings:'SV','Debt Payment':'DT','Credit Card':'CC','Transfer Fees':'TF',Transfer:'TR',MP2:'MP',Other:'OT'};let key=String(c||'Other').trim();if(map[key])return map[key];let words=key.split(/\s+/).filter(Boolean);return (words.length>1?words.map(w=>w[0]).join(''):key.slice(0,2)).slice(0,2).toUpperCase()||'OT'}
function catIcon(c){
  const key=String(c||'Other').trim();
  const rawIcon=key.startsWith('__icon:')?key.slice(7):'';
  const kind=rawIcon||(data.categoryIcons&&data.categoryIcons[key])||{Food:'food',Groceries:'cart',Coffee:'cup',Dining:'food',Transport:'car',Gas:'fuel',Parking:'park',Shopping:'bag',Bills:'receipt',Utilities:'bolt',Rent:'home',Internet:'wifi',Phone:'phone',Health:'heart',Medicine:'pill',Insurance:'shield',Travel:'plane',Entertainment:'play',Subscriptions:'repeat',Education:'book',Family:'users',Pets:'paw',Gifts:'gift',Salary:'wallet',Bonus:'gift',Freelance:'briefcase',Interest:'bank',Refund:'return',Investment:'trend',Savings:'bank','Debt Payment':'card','Credit Card':'card','Transfer Fees':'swap',Transfer:'swap',MP2:'bank',Other:'tag'}[key];
  const paths={broom:'<path d="M14 3l7 7M12 5l7 7M13 8 5 16l3 3 8-8M4 17l3 3M3 21c3-1 5-1 7 0"/>',helper:'<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0M9 15l3 3 3-3"/>',laundry:'<path d="M5 3h14v18H5V3ZM8 6h2M13 6h3M9 14a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z"/>',wrench:'<path d="M14 7a5 5 0 0 0 6 6L11 22l-5-5 9-9ZM6 17l-4 4"/>',baby:'<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21c1-4 4-6 7-6s6 2 7 6M9 9h.1M15 9h.1"/>',shirt:'<path d="M8 4 4 7l2 4 2-1v11h8V10l2 1 2-4-4-3-2 2h-4L8 4Z"/>',scissors:'<path d="M4 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM4 17a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM9 8l11 8M9 16l11-8"/>',beauty:'<path d="M8 21h8M10 21V9l2-6 2 6v12M7 9h10"/>',food:'<path d="M7 3v8M11 3v8M7 7h4M9 11v10M17 3v18M15 3h4"/>',cart:'<path d="M4 5h2l2 10h9l2-7H7M9 20h.1M17 20h.1"/>',cup:'<path d="M6 8h10v5a5 5 0 0 1-10 0V8Z"/><path d="M16 9h2a3 3 0 0 1 0 6h-2M5 20h12"/>',car:'<path d="M5 13l2-5h10l2 5M5 13h14v5H5v-5ZM7 18v2M17 18v2M8 15h.1M16 15h.1"/>',fuel:'<path d="M6 21V4h9v17M6 9h9M15 7l3 3v8a2 2 0 0 0 4 0v-5l-3-3"/>',park:'<path d="M7 21V4h7a4 4 0 0 1 0 8H7"/>',bag:'<path d="M6 8h12l-1 13H7L6 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/>',receipt:'<path d="M7 3h10v18l-2-1-2 1-2-1-2 1-2-1V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/>',bolt:'<path d="M13 2 5 14h6l-1 8 8-12h-6l1-8Z"/>',home:'<path d="M4 11 12 4l8 7M6 10v10h12V10M10 20v-6h4v6"/>',wifi:'<path d="M4 9a12 12 0 0 1 16 0M7 12a7 7 0 0 1 10 0M10 15a3 3 0 0 1 4 0M12 19h.1"/>',phone:'<path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2"/>',heart:'<path d="M20 8.5c0 5-8 10-8 10s-8-5-8-10A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 2.5Z"/>',pill:'<path d="M10 21 21 10a4 4 0 0 0-6-6L4 15a4 4 0 0 0 6 6ZM8 11l5 5"/>',shield:'<path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Z"/>',plane:'<path d="M3 11h18L13 3v6L7 6v5l-4 4v-4Z"/>',play:'<path d="M8 5v14l11-7L8 5Z"/>',repeat:'<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',book:'<path d="M4 5a3 3 0 0 1 3-3h13v17H7a3 3 0 0 0-3 3V5Z"/><path d="M4 19a3 3 0 0 1 3-3h13"/>',users:'<path d="M16 11a4 4 0 1 0-8 0M3 21a7 7 0 0 1 14 0M17 8a3 3 0 0 1 0 6M18 17a5 5 0 0 1 3 4"/>',paw:'<path d="M12 13c3 0 5 2 5 5a3 3 0 0 1-5 2 3 3 0 0 1-5-2c0-3 2-5 5-5ZM6 10h.1M10 7h.1M14 7h.1M18 10h.1"/>',gift:'<path d="M4 9h16v12H4V9ZM12 9v12M4 13h16M7 9a3 3 0 1 1 5 0M12 9a3 3 0 1 1 5 0"/>',wallet:'<path d="M4 7h16v12H4V7ZM16 12h4v4h-4a2 2 0 0 1 0-4ZM4 7l12-3 2 3"/>',briefcase:'<path d="M4 7h16v12H4V7ZM9 7V5h6v2M4 12h16"/>',bank:'<path d="M3 10 12 4l9 6M5 10h14M6 10v9M10 10v9M14 10v9M18 10v9M4 19h16"/>',return:'<path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-1"/>',trend:'<path d="M4 17 10 11l4 4 6-8M16 7h4v4"/>',card:'<path d="M3 6h18v12H3V6ZM3 10h18M7 15h4"/>',swap:'<path d="M7 7h13l-4-4M17 17H4l4 4"/>',tag:'<path d="M4 12V4h8l8 8-8 8-8-8ZM8 8h.1"/>'};
  if(kind)return '<svg class="catSvg" viewBox="0 0 24 24" fill="none" aria-hidden="true">'+paths[kind]+'</svg>';
  return '<span class="catLetters">'+categoryCode(key)+'</span>';
}function selectAccount(id){
  if(txnType==='Transfer'){
    if(pickerField==='from' && id===txn.to) return alert('From and To cannot be the same account.');
    if(pickerField==='to' && id===txn.from) return alert('From and To cannot be the same account.');
  }
  txn[pickerField]=id;
  closePicker();
  renderTxn();
}
function selectCategory(c){c=String(c||'').trim();if(!c)return;if(!data.categories.some(x=>x.toLowerCase()===c.toLowerCase())){data.categories.push(c);try{localStorage.setItem(KEY,JSON.stringify(data))}catch(e){}}if(pickerMode==='recurringCategory'){recurringDraftCategory=c;let input=document.getElementById('recCategory');if(input)input.value=c;let btn=document.getElementById('recCategoryPick');if(btn)btn.innerHTML=`<div class="catCircle">${catIcon(c)}</div><div class="txnPickText"><b>${document.getElementById('recType')?.value==='Income'?'Source':'Category'}</b><span>${htmlText(c)}</span><em>Recurring ${document.getElementById('recType')?.value==='Income'?'income source':'expense category'}</em></div>`;closePicker();return}txn.category=c;closePicker();renderTxn()}
function applyTxn(t){let amt=Number(t.amount||0),from=data.accounts.find(a=>a.id===t.from),to=data.accounts.find(a=>a.id===t.to);if(t.type==='Income'){if(from)from.balance=(from.balance||0)+amt}else if(t.type==='Expense'){if(!from)return false;if(from.type==='Credit Card'){from.outstanding=(from.outstanding||0)+amt;t.billId=generateBill(from,amt,t.date)}else from.balance=(from.balance||0)-amt}else if(t.type==='Transfer'){if(!from||!to)return false;let fee=Number(t.fee||0);if(from.type==='Credit Card')from.outstanding=Math.max(0,(from.outstanding||0)-amt);else from.balance=(from.balance||0)-amt-fee;if(to.type==='Credit Card')to.outstanding=Math.max(0,(to.outstanding||0)-amt);else to.balance=(to.balance||0)+amt}else if(t.type==='Card Payment'){if(from)from.balance=(from.balance||0)-amt;if(to)to.outstanding=Math.max(0,(to.outstanding||0)-amt);if(t.billId){let b=data.bills.find(x=>x.id===t.billId);if(b){b.remaining=Math.max(0,(b.remaining||0)-amt);b.status=b.remaining<=0?'Paid':'Partial'}}}return true}
function reverseTxn(t){let amt=Number(t.amount||0),from=data.accounts.find(a=>a.id===t.from),to=data.accounts.find(a=>a.id===t.to);if(t.type==='Income'){if(from)from.balance=(from.balance||0)-amt}else if(t.type==='Expense'){if(from&&from.type==='Credit Card'){from.outstanding=Math.max(0,(from.outstanding||0)-amt);adjustBill(t.billId,-amt)}else if(from)from.balance=(from.balance||0)+amt}else if(t.type==='Transfer'){let fee=Number(t.fee||0);if(from&&from.type==='Credit Card')from.outstanding=(from.outstanding||0)+amt;else if(from)from.balance=(from.balance||0)+amt+fee;if(to&&to.type==='Credit Card')to.outstanding=(to.outstanding||0)+amt;else if(to)to.balance=(to.balance||0)-amt}else if(t.type==='Card Payment'){if(from)from.balance=(from.balance||0)+amt;if(to)to.outstanding=(to.outstanding||0)+amt;adjustBill(t.billId,amt)}}
function adjustBill(id,delta){if(!id)return;let b=data.bills.find(x=>x.id===id);if(!b)return;b.amount=Math.max(0,(b.amount||0)+delta);b.remaining=Math.max(0,(b.remaining||0)+delta);b.status=b.remaining<=0?'Paid':(b.remaining<b.amount?'Partial':'Unpaid')}
function saveTxn(){
  try{
    let amt=Number(amount||0);
    if(!amt || amt<=0) return alert('Enter amount');
    if(txnType==='Expense'&&!txn.from) return alert('Choose account');
    if(txnType==='Income'&&!txn.from) return alert('Choose deposit account');
    if(txnType==='Transfer'){
      if(!txn.from||!txn.to) return alert('Choose both accounts');
      if(txn.from===txn.to) return alert('From and To account cannot be the same.');
    }
    let old=editingTxn?data.txns.find(t=>t.id===editingTxn):null;
    let newTxn={
      id:editingTxn||uid(),
      type:txnType,
      amount:amt,
      fee:txnType==='Transfer'?Number(txn.fee||0):0,
      category:txnType==='Transfer'?'':(txn.category||'Other'),
      note:(document.getElementById('txnNote')?.value||'').trim(),
      date:txnIsoFromInput(document.getElementById('txnDate')?.value, old?.date),
      from:txn.from,
      to:txn.to
    };
    if(editingTxn){
      if(old) reverseTxn(old);
      if(!applyTxn(newTxn)){
        if(old) applyTxn(old);
        return alert('Unable to save transaction. Check accounts.');
      }
      data.txns=data.txns.map(t=>t.id===editingTxn?newTxn:t);
    }else{
      if(!applyTxn(newTxn)) return alert('Unable to save transaction. Check accounts.');
      data.txns.push(newTxn);
    }
    editingTxn=null;
    closeSheets();
    persist();
    if(typeof showToast==='function') showToast(old?'Transaction updated':'Transaction saved');
  }catch(e){
    console.error('Save transaction failed',e);
    alert('Save Transaction failed: '+(e&&e.message?e.message:e));
  }
}
function generateBill(card,amt,forDate){let now=forDate?new Date(forDate):new Date();if(isNaN(now.getTime()))now=new Date();let y=now.getFullYear(),m=now.getMonth(),sd=card.statementDay||1,dd=card.dueDay||1;let st=new Date(y,m,sd);if(now>st)st=new Date(y,m+1,sd);let due=new Date(st.getFullYear(),st.getMonth()+(dd<=sd?1:0),dd);let prev=new Date(st.getFullYear(),st.getMonth()-1,sd+1);let id=card.id+'-'+st.toISOString().slice(0,10);let b=data.bills.find(x=>x.id===id);if(!b){b={id,cardId:card.id,cardName:card.name,periodStart:prev.toISOString().slice(0,10),periodEnd:st.toISOString().slice(0,10),statementDate:st.toISOString().slice(0,10),dueDate:due.toISOString().slice(0,10),amount:0,remaining:0,status:'Unpaid'};data.bills.push(b)}b.cardName=card.name;b.amount+=amt;b.remaining+=amt;b.status=billStatus(b);return id}
function setPayAmount(mode){if(!settling)return;document.querySelectorAll('.payMode').forEach(b=>b.classList.remove('active'));let btn=document.querySelector(`[data-paymode="${mode}"]`);if(btn)btn.classList.add('active');if(mode==='full')payAmount.value=Number(settling.remaining||0);if(mode==='half')payAmount.value=Math.ceil(Number(settling.remaining||0)/2);if(mode==='custom'){payAmount.focus();payAmount.select()}}
function openSettle(id){settling=data.bills.find(b=>b.id===id);if(!settling){alert('This bill is no longer available to settle.');return}let detail=document.getElementById('accountDetailSheet');if(detail)detail.classList.remove('show');let banks=data.accounts.filter(a=>a.type!=='Credit Card');let card=data.accounts.find(a=>a.id===settling.cardId)||{};settleBody.innerHTML=`<div class="paySummary"><div class="small">${settling.cardName}</div><h3 style="margin:6px 0 2px">${peso(settling.remaining)}</h3><div class="sub">Due ${settling.dueDate} - ${billPeriod(settling)}</div></div>${banks.length?`<label class="small">Pay from</label><select class="field" id="payFrom">${banks.map(a=>`<option value="${a.id}">${a.name} (${a.institution}) - ${peso(a.balance||0)}</option>`).join('')}</select><div class="paymentModes"><button class="payMode active" data-paymode="full" onclick="setPayAmount('full')">Full remaining</button><button class="payMode" data-paymode="half" onclick="setPayAmount('half')">Half</button></div><label class="small">Payment amount</label><input class="field" id="payAmount" type="number" value="${settling.remaining}"><button class="save" onclick="settleBill()">Record Payment</button>`:'<div class="empty">Add a Savings, Wallet, Cash, or Investment account first so you can choose where the payment comes from.</div>'}<div class="payHistory"><div class="small">Previous payments</div>${billPayments(settling).length?billPayments(settling).map(p=>`<div class="historyRow"><span>${txnDate(p)} - ${accountLabel(p.from)}</span><b>${peso(p.amount)}</b></div>`).join(''):'<div class="sub">No payments recorded yet.</div>'}</div>`;showModal();settleSheet.classList.add('show')}
function settleBill(){let a=data.accounts.find(x=>x.id===payFrom.value),card=data.accounts.find(x=>x.id===settling.cardId),amt=Number(payAmount.value||0);if(!a||!card||!amt)return alert('Choose account and amount');if(amt>Number(settling.remaining||0)&&!confirm('Payment is higher than the remaining bill. Continue?'))return;let t={id:uid(),type:'Card Payment',amount:amt,date:new Date().toISOString(),from:a.id,to:card.id,billId:settling.id};applyTxn(t);data.txns.push(t);persist();closeSheets()}
function txnDate(t){return new Date(t.date||Date.now()).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}
function txnRow(t,compact=false){let s=txnSummary(t),canEdit=['Income','Expense','Transfer'].includes(t.type),note=t.note?`<div class="txnNoteLine">${escapeHtml(t.note)}</div>`:'';return `<div class="row txnRow txn-${s.tone}"><div class="txnMain"><div class="txnTitleLine"><span class="txnTypePill">${htmlText(s.label)}</span></div><div class="txnMeta">${txnDate(t)} - ${s.left}</div>${note}${compact?'':`<div class="txnActions">${canEdit?`<button class="tiny" onclick="openTxn('${jsString(t.id)}')">Edit</button>`:''}<button class="tiny danger" onclick="deleteTxn('${jsString(t.id)}')">Delete</button></div>`}</div><b class="txnAmount">${s.right}</b></div>`}
function txnMatches(t,q){if(!q)return true;let hay=[t.type,t.category,t.note,accountLabel(t.from),accountLabel(t.to),String(t.amount),txnDate(t)].join(' ').toLowerCase();return hay.includes(q.toLowerCase())}
function accountOptionsForRecurring(type,selected=''){let arr=data.accounts.filter(a=>type==='Income'?a.type!=='Credit Card':true);return arr.map(a=>`<option value="${a.id}" ${a.id===selected?'selected':''}>${a.name} (${a.institution||a.type}) - ${a.type==='Credit Card'?'Outstanding '+peso(a.outstanding||0):'Balance '+peso(a.balance||0)}</option>`).join('')}
function renderRecurringFields(r={}){let type=recType.value;let selected=recurringDraftCategory||r.category||(type==='Income'?'Salary':'Food');recurringDraftCategory=selected;recDynamic.innerHTML=`<label class="small">${type==='Income'?'Deposit to':'Pay from'}</label><select class="field" id="recAccount">${accountOptionsForRecurring(type,r.accountId||'')}</select><input type="hidden" id="recCategory" value="${htmlText(selected)}"><button type="button" id="recCategoryPick" class="txnPickBtn wide" onclick="chooseRecurringCat()"><div class="catCircle">${catIcon(selected)}</div><div class="txnPickText"><b>${type==='Income'?'Source':'Category'}</b><span>${htmlText(selected)}</span><em>Recurring ${type==='Income'?'income source':'expense category'}</em></div></button>`}
function openRecurring(id){editingRecurring=id||null;let r=editingRecurring?data.recurring.find(x=>x.id===editingRecurring):null;recTitle.textContent=r?'Edit Recurring':'Add Recurring';recType.value=r?.type||'Income';recName.value=r?.name||'';recAmount.value=r?.amount||'';recDay.value=r?.day||'';recEnabled.checked=r? r.enabled!==false:true;recurringDraftCategory=r?.category||(recType.value==='Income'?'Salary':'Food');renderRecurringFields(r||{});recDeleteBtn.classList.toggle('hide',!r);showModal();recurringSheet.classList.add('show')}
function saveRecurring(){let type=recType.value,accountId=recAccount.value,amount=Number(recAmount.value||0),day=Math.max(1,Math.min(31,Number(recDay.value||0))),category=(document.getElementById('recCategory')?.value||recurringDraftCategory||'Other').trim();if(!accountId)return alert('Choose an account');if(!category)return alert('Choose a category');if(!amount)return alert('Enter amount');if(!day)return alert('Enter day of month');let r=data.recurring.find(x=>x.id===editingRecurring)||{id:uid(),createdAt:new Date().toISOString()};r.type=type;r.name=recName.value||category||type;r.accountId=accountId;r.category=category;r.amount=amount;r.day=day;r.enabled=recEnabled.checked;if(!editingRecurring)data.recurring.push(r);persist();closeSheets();toastMsg('Recurring item saved')}
function deleteRecurring(){if(!editingRecurring)return closeSheets();if(!confirm('Delete this recurring rule? Already generated transactions will remain.'))return;data.recurring=data.recurring.filter(r=>r.id!==editingRecurring);editingRecurring=null;persist();closeSheets()}
function nextRecurringDate(r){let now=new Date(),d=new Date(now.getFullYear(),now.getMonth(),Math.min(Number(r.day||1),daysInMonth(now.getFullYear(),now.getMonth())));d.setHours(0,0,0,0);if(d<new Date(now.getFullYear(),now.getMonth(),now.getDate()))d=new Date(now.getFullYear(),now.getMonth()+1,Math.min(Number(r.day||1),daysInMonth(now.getFullYear(),now.getMonth()+1)));return d}
function daysInMonth(y,m){return new Date(y,m+1,0).getDate()}
function occurrenceDateFor(r,y,m){return new Date(y,m,Math.min(Number(r.day||1),daysInMonth(y,m)))}
function runRecurring(showMsg=true){return 0}
function recurringDaySuffix(n){n=Number(n||0);let v=n%100;if(v>=11&&v<=13)return 'th';return ({1:'st',2:'nd',3:'rd'}[n%10]||'th')}
function recurringMonthKey(d=new Date()){let date=d instanceof Date?d:new Date(d||Date.now());return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')}
function currentRecurringOccurrence(r){let now=new Date();return occurrenceDateFor(r,now.getFullYear(),now.getMonth())}
function recurringOccurrenceKey(r,d){let date=d||currentRecurringOccurrence(r);return date.toISOString().slice(0,10)}
function recurringIsPaidThisMonth(r){let key=recurringMonthKey(new Date());return (data.txns||[]).some(t=>t.recurringId===r.id&&(t.occurrenceMonth===key||String(t.occurrenceKey||'').slice(0,7)===key))}
function payRecurring(id){let r=data.recurring.find(x=>x.id===id);if(!r)return;let a=data.accounts.find(x=>x.id===r.accountId);if(!a)return alert('Choose an account for this recurring item first.');if(r.enabled===false)return alert('Enable this recurring item first.');if(recurringIsPaidThisMonth(r))return toastMsg((r.type==='Income'?'Received':'Paid')+' for this month already');let occ=currentRecurringOccurrence(r),key=recurringOccurrenceKey(r,occ);let t={id:uid(),type:r.type,amount:Number(r.amount||0),fee:0,category:r.category||r.name||r.type,date:new Date().toISOString(),from:r.accountId,to:null,recurringId:r.id,occurrenceKey:key,occurrenceMonth:recurringMonthKey(occ),note:'Recurring: '+(r.name||r.type)};if(!applyTxn(t))return alert('Could not record this recurring transaction.');data.txns.push(t);persist();toastMsg(r.type==='Income'?'Marked received':'Marked paid')}
function renderRecurring(){let el=document.getElementById('recurringList');if(!el)return;let arr=data.recurring||[];el.innerHTML=arr.length?arr.map(r=>{let a=data.accounts.find(x=>x.id===r.accountId);let next=nextRecurringDate(r);let paid=recurringIsPaidThisMonth(r);let action=r.type==='Income'?'Received':'Pay';let doneLabel=r.type==='Income'?'Received':'Paid';let disabled=r.enabled===false;return `<div class="recurringCard ${paid?'isPaid':''}"><div class="recTop"><div class="recIdentity"><b>${htmlText(r.name)}</b><div class="recMeta">${htmlText(r.type)} - ${htmlText(r.category||'Other')} - ${a?htmlText(a.name)+' ('+htmlText(a.institution||a.type)+')':'Missing account'}</div></div><span class="recPill ${paid?'paid':'due'}">${paid?doneLabel:'Every '+htmlText(r.day)+recurringDaySuffix(r.day)}</span></div><div class="minirow" style="margin-top:10px"><span>Amount</span><b>${peso(r.amount)}</b></div><div class="minirow"><span>Next</span><b>${next.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</b></div><div class="recActions"><button class="tiny" onclick="openRecurring('${jsString(r.id)}')">Edit</button><button class="tiny ${disabled?'':'danger'}" onclick="toggleRecurring('${jsString(r.id)}')">${disabled?'Enable':'Disable'}</button>${paid?'':`<button class="tiny primary" ${disabled?'disabled':''} onclick="payRecurring('${jsString(r.id)}')">${action}</button>`}</div></div>`}).join(''):'<div class="row"><span class="sub">No recurring items yet. Add salary, subscriptions, MP2, utilities, or monthly bills.</span></div>'}

function currentMonthRange(){let now=new Date();return {start:new Date(now.getFullYear(),now.getMonth(),1),end:new Date(now.getFullYear(),now.getMonth()+1,1)}}
function monthlyCategorySpend(){let {start,end}=currentMonthRange(),spend={};data.txns.filter(t=>txInPeriod(t,start,end)).forEach(t=>{if(t.type==='Expense')groupAdd(spend,t.category||'Other',Number(t.amount||0));if(t.type==='Transfer'&&Number(t.fee||0))groupAdd(spend,'Transfer Fees',Number(t.fee||0))});return spend}
function openBudget(id){editingBudget=id||null;let b=editingBudget?data.budgets.find(x=>x.id===editingBudget):null;let cats=[...new Set((data.categories||defaultCategories()).concat(b&&b.category?[b.category]:[]))];budgetCategory.innerHTML=cats.map(c=>`<option value="${htmlText(c)}">${categoryCode(c)} - ${htmlText(c)}</option>`).join('');budgetTitle.textContent=b?'Edit Budget':'Add Budget';budgetCategory.value=b?.category||'Food';budgetAmount.value=b?.amount||'';budgetDeleteBtn.classList.toggle('hide',!b);showModal();budgetSheet.classList.add('show')}
function saveBudget(){let cat=budgetCategory.value,amt=Number(budgetAmount.value||0);if(!cat)return alert('Choose category');if(!amt)return alert('Enter monthly limit');let b=data.budgets.find(x=>x.id===editingBudget)||{id:uid()};b.category=cat;b.amount=amt;if(!editingBudget)data.budgets.push(b);persist();closeSheets()}
function deleteBudget(id){let bid=id||editingBudget;if(!bid)return closeSheets();if(!confirm('Delete this budget?'))return;data.budgets=data.budgets.filter(b=>b.id!==bid);if(editingBudget===bid)editingBudget=null;persist();closeSheets()}

function monthRange(offset=0){let now=new Date();let start=new Date(now.getFullYear(),now.getMonth()+offset,1);let end=new Date(now.getFullYear(),now.getMonth()+offset+1,1);return {start,end}}
function txnsInRange(start,end){return data.txns.filter(t=>{let d=new Date(t.date);return d>=start&&d<end})}
function summarizeTxns(txns){let income=0,expense=0,cats={},sources={};txns.forEach(t=>{let amt=Number(t.amount||0);if(t.type==='Income'){income+=amt;groupAdd(sources,t.category||accountLabel(t.from)||'Income',amt)}else if(t.type==='Expense'){expense+=amt;groupAdd(cats,t.category||'Other',amt)}else if(t.type==='Transfer'&&Number(t.fee||0)>0){expense+=Number(t.fee||0);groupAdd(cats,'Transfer Fees',Number(t.fee||0))}});return {income,expense,net:income-expense,cats,sources,savingsRate:income>0?Math.round(((income-expense)/income)*100):0}}
function averageCardUtilization(){let cards=data.accounts.filter(a=>a.type==='Credit Card'&&Number(a.limit||0)>0);if(!cards.length)return 0;return Math.round(cards.reduce((s,a)=>s+(Number(a.outstanding||0)/Number(a.limit||1))*100,0)/cards.length)}
function budgetComplianceScore(){if(!data.budgets||!data.budgets.length)return 85;let spend=monthlyCategorySpend(),scores=data.budgets.map(b=>{let used=Number(spend[b.category]||0),limit=Number(b.amount||0)||1,pct=used/limit;if(pct<=.8)return 100;if(pct<=1)return 75;return Math.max(20,100-Math.round((pct-1)*120))});return Math.round(scores.reduce((a,b)=>a+b,0)/scores.length)}
function unpaidBillScore(){let unpaid=(data.bills||[]).filter(b=>b.status!=='Paid');if(!unpaid.length)return 100;let overdue=unpaid.filter(b=>daysUntil(b.dueDate)<0).length,soon=unpaid.filter(b=>daysUntil(b.dueDate)>=0&&daysUntil(b.dueDate)<=3).length;return Math.max(20,100-overdue*35-soon*12)}
function calculateHealth(){let cur=summarizeTxns(txnsInRange(monthRange(0).start,monthRange(0).end));let savingsScore=cur.income>0?Math.max(0,Math.min(100,50+cur.savingsRate)):70;let util=averageCardUtilization();let utilScore=Math.max(0,100-util*2);let budgetScore=budgetComplianceScore();let billScore=unpaidBillScore();let score=Math.round(savingsScore*.35+utilScore*.25+budgetScore*.25+billScore*.15);let label=score>=90?'Excellent':score>=75?'Good':score>=60?'Needs attention':'At risk';return {score,label,cur,util,budgetScore,billScore}}
function setHealthRing(id,score){let el=document.getElementById(id);if(!el)return;let deg=Math.max(0,Math.min(100,score))*3.6;el.style.background=`conic-gradient(var(--accent) ${deg}deg,#eef1f7 ${deg}deg)`}
function sparkline(id,values){let el=document.getElementById(id);if(!el)return;let max=Math.max(1,...values.map(v=>Math.abs(v)));el.innerHTML=values.map(v=>`<i style="height:${Math.max(8,Math.round((Math.abs(v)/max)*36))}px;opacity:${v?'.9':'.25'}"></i>`).join('')}
function pctChange(cur,prev){if(!prev&&cur)return 100;if(!prev)return 0;return Math.round(((cur-prev)/prev)*100)}
function renderAnalytics(){let h=calculateHealth();[['healthScoreDash',h.score],['healthScoreReport',h.score]].forEach(([id,val])=>{let el=document.getElementById(id);if(el)el.textContent=val});setHealthRing('healthRing',h.score);setHealthRing('healthRingReport',h.score);let labelDash=document.getElementById('healthLabelDash'),labelRep=document.getElementById('healthLabelReport');if(labelDash)labelDash.textContent=h.label;if(labelRep)labelRep.textContent=h.label;let sumDash=document.getElementById('healthSummaryDash');if(sumDash)sumDash.textContent=h.cur.income?`${h.cur.savingsRate}% savings rate this month.`:'Add income and expenses to unlock a better score.';let hs=document.getElementById('healthSavingsDash');if(hs)hs.textContent=h.cur.income?`${h.cur.savingsRate}%`:'--';let hu=document.getElementById('healthUtilDash');if(hu)hu.textContent=data.accounts.some(a=>a.type==='Credit Card')?`${h.util}%`:'--';let sr=document.getElementById('savingsRateReport');if(sr)sr.textContent=h.cur.income?`${h.cur.savingsRate}%`:'No income yet';let months=[-5,-4,-3,-2,-1,0].map(o=>summarizeTxns(txnsInRange(monthRange(o).start,monthRange(o).end)));sparkline('incomeSpark',months.map(m=>m.income));sparkline('expenseSpark',months.map(m=>m.expense));let prev=months[4],cur=months[5];let expChange=pctChange(cur.expense,prev.expense);let expEl=document.getElementById('expenseTrendReport');if(expEl)expEl.textContent=prev.expense?`${expChange>0?'+':''}${expChange}% vs last month`:'No previous month';let compare=document.getElementById('monthCompareReport');if(compare)compare.innerHTML=`<div class="monthBox"><span class="small">Last Month</span><b>${peso(prev.expense)}</b><div class="sub">Expenses</div></div><div class="monthArrow">?</div><div class="monthBox"><span class="small">This Month</span><b>${peso(cur.expense)}</b><div class="sub">${expChange<=0?'Down':'Up'} ${Math.abs(expChange)}%</div></div>`;let cats=Object.entries(cur.cats).sort((a,b)=>b[1]-a[1]);let catEl=document.getElementById('analyticsCategories');if(catEl){let max=Math.max(1,...cats.map(x=>x[1]));catEl.innerHTML=cats.length?cats.slice(0,6).map(([k,v])=>`<div class="analyticsBar"><b>${catIcon(k)} ${k}</b><div class="analyticsTrack"><i style="width:${Math.round(v/max*100)}%"></i></div><strong>${peso(v)}</strong></div>`).join(''):'<div class="reportEmpty">No expense categories for this month yet.</div>'}let smart=document.getElementById('smartAnalyticsReport');if(smart){let items=[];if(h.cur.income)items.push({kind:h.cur.savingsRate>=30?'good':h.cur.savingsRate>=10?'warn':'danger',text:`Your savings rate this month is ${h.cur.savingsRate}%.`});if(cats[0])items.push({kind:'warn',text:`Top spending category is ${cats[0][0]} at ${peso(cats[0][1])}.`});if(h.util>30)items.push({kind:'warn',text:`Average credit utilization is ${h.util}%. Consider keeping it lower.`});else if(data.accounts.some(a=>a.type==='Credit Card'))items.push({kind:'good',text:`Average credit utilization is ${h.util}%, which is healthy.`});let dueSoon=(data.bills||[]).filter(b=>b.status!=='Paid').map(b=>({...b,days:daysUntil(b.dueDate)})).filter(b=>b.days>=0&&b.days<=7).sort((a,b)=>a.days-b.days)[0];if(dueSoon)items.push({kind:dueSoon.days<=2?'danger':'warn',text:`${dueSoon.cardName} is due in ${dueSoon.days} day${dueSoon.days===1?'':'s'} for ${peso(dueSoon.remaining)}.`});if(!items.length)items.push({kind:'good',text:'No urgent insights yet. Add more transactions for better analytics.'});smart.innerHTML=items.map(i=>`<div class="insightTone ${i.kind}">${i.text}</div>`).join('')}}

function renderInsights(){let el=document.getElementById('insightReport');if(!el)return;let spend=monthlyCategorySpend(),items=[];(data.budgets||[]).forEach(b=>{let used=Number(spend[b.category]||0),limit=Number(b.amount||0),pct=limit?used/limit:0;if(pct>=1)items.push({kind:'danger',text:`${b.category} is over budget by ${peso(used-limit)}.`});else if(pct>=.8)items.push({kind:'warn',text:`${b.category} is at ${Math.round(pct*100)}% of its monthly budget.`});else if(used>0)items.push({kind:'good',text:`${b.category} still has ${peso(limit-used)} left this month.`})});let cards=data.accounts.filter(a=>a.type==='Credit Card'&&Number(a.limit||0)>0);cards.forEach(c=>{let pct=Number(c.outstanding||0)/Number(c.limit||1);if(pct>=.5)items.push({kind:'warn',text:`${c.name} utilization is ${Math.round(pct*100)}%.`});else if(Number(c.outstanding||0)>0)items.push({kind:'good',text:`${c.name} utilization is low at ${Math.round(pct*100)}%.`})});let dueSoon=(data.bills||[]).filter(b=>b.status!=='Paid').map(b=>({...b,days:daysUntil(b.dueDate)})).filter(b=>b.days>=0&&b.days<=7).sort((a,b)=>a.days-b.days);dueSoon.forEach(b=>items.unshift({kind:b.days<=2?'danger':'warn',text:`${b.cardName} is due in ${b.days} day${b.days===1?'':'s'} for ${peso(b.remaining)}.`}));if(!items.length)items.push({kind:'good',text:'No urgent budget or bill alerts right now.'});el.innerHTML=items.slice(0,5).map(i=>`<div class="insightItem ${i.kind}">${i.text}</div>`).join('')}

function ordinal(n){n=Number(n||0);if([11,12,13].includes(n%100))return 'th';return {1:'st',2:'nd',3:'rd'}[n%10]||'th'}
function toggleRecurring(id){let r=data.recurring.find(x=>x.id===id);if(!r)return;r.enabled=!(r.enabled!==false);persist()}
function exportBackup(){let payload={app:'PesoTrack',version:'3.55',exportedAt:new Date().toISOString(),data};let blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='pesotrack-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href)}function importBackup(){restoreFile.click()}function handleRestore(input){let file=input.files&&input.files[0];if(!file)return;let reader=new FileReader();reader.onload=()=>{try{let payload=JSON.parse(reader.result);let incoming=payload.data||payload;if(!incoming||!Array.isArray(incoming.accounts)||!Array.isArray(incoming.txns)||!Array.isArray(incoming.bills))throw new Error('Invalid backup');if(!confirm('Restore this backup? Current local data will be replaced.'))return;data=normalizeData(incoming);persist();alert('Backup restored.')}catch(e){alert('Could not restore backup: '+e.message)}finally{input.value=''}};reader.readAsText(file)}
function applySettings(){if(data.settings){data.settings.dark=true;data.settings.privacy=false;data.settings.pinEnabled=false;data.settings.pinHash=''}document.body.classList.remove('privacy');document.body.classList.add('dark')}
function toastMsg(msg){if(!window.toast)return;toast.textContent=msg;toast.classList.add('show');clearTimeout(window._toastTimer);window._toastTimer=setTimeout(()=>toast.classList.remove('show'),1800)}

function csvEscape(v){v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function downloadText(name,text,type='text/plain'){let blob=new Blob([text],{type});let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function exportTransactionsCSV(){let rows=[['Date','Type','Account From','Account To','Category','Amount','Fee']];data.txns.forEach(t=>rows.push([new Date(t.date).toLocaleString('en-PH'),t.type,accountLabel(t.from),accountLabel(t.to),t.category||'',Number(t.amount||0),Number(t.fee||0)]));downloadText('pesotrack-transactions.csv',rows.map(r=>r.map(csvEscape).join(',')).join('\n'),'text/csv')}
function exportReportCSV(){let {start,end}=periodStartEnd(),acct=(document.getElementById('reportAccount')||{}).value||'All';let rows=[['Report Period',reportPeriod],['From',start.toISOString().slice(0,10)],['To',end.toISOString().slice(0,10)],['Account',acct==='All'?'All accounts':accountLabel(acct)],[],['Date','Type','Account From','Account To','Category','Amount','Fee']];data.txns.filter(t=>txInPeriod(t,start,end)).filter(t=>acct==='All'||t.from===acct||t.to===acct).forEach(t=>rows.push([new Date(t.date).toLocaleDateString('en-PH'),t.type,accountLabel(t.from),accountLabel(t.to),t.category||'',Number(t.amount||0),Number(t.fee||0)]));downloadText('pesotrack-report-'+reportPeriod.toLowerCase()+'.csv',rows.map(r=>r.map(csvEscape).join(',')).join('\n'),'text/csv')}
function saveSettings(){data.settings.weekStart=weekStart.value;data.settings.currency=currencySetting.value;persist();toastMsg('Settings saved')}
function addCategoryFromSettings(){let input=document.getElementById('settingsCategoryInput');let c=input?input.value:prompt('Category name');if(!c)return;c=String(c).trim();if(!c)return;if(!data.categories.some(x=>x.toLowerCase()===c.toLowerCase()))data.categories.push(c);data.categoryIcons=data.categoryIcons||{};data.categoryIcons[c]=settingsCategoryIcon||suggestCategoryIcon(c);if(input)input.value='';persist();toastMsg('Category added')}
function deleteCategory(c){if(defaultCategories().includes(c)){alert('Default categories cannot be deleted.');return}if(confirm('Delete category '+c+'? Existing transactions will keep their category text.')){data.categories=data.categories.filter(x=>x!==c);if(data.categoryIcons)delete data.categoryIcons[c];persist();toastMsg('Category removed')}}

function categoryIconChoices(){return ['car','fuel','park','broom','helper','laundry','wrench','baby','shirt','scissors','beauty','food','cart','cup','bag','receipt','bolt','home','wifi','phone','heart','pill','shield','plane','play','repeat','book','users','paw','gift','wallet','briefcase','bank','return','trend','card','swap','tag']}function suggestCategoryIcon(c){let key=String(c||'').toLowerCase();if(/helper|housemaid|maid|cleaner|cleaning/.test(key))return 'helper';if(/laundry|wash|clothes/.test(key))return 'laundry';if(/repair|maintenance|tool|fix/.test(key))return 'wrench';if(/baby|child|kid|daycare/.test(key))return 'baby';if(/beauty|salon|hair|personal care/.test(key))return 'beauty';if(/car|auto|vehicle/.test(key))return 'car';if(/gas|fuel/.test(key))return 'fuel';if(/grocery|market/.test(key))return 'cart';if(/coffee|cafe/.test(key))return 'cup';if(/shop|mall/.test(key))return 'bag';if(/bill|receipt/.test(key))return 'receipt';if(/rent|home|house/.test(key))return 'home';if(/health|doctor|medicine/.test(key))return 'heart';if(/travel|flight|trip/.test(key))return 'plane';if(/school|book|education/.test(key))return 'book';if(/salary|income|pay/.test(key))return 'wallet';return 'tag'}function selectCategoryIcon(icon){settingsCategoryIcon=icon;renderCategoryManager()}function categoryIconPreview(icon){return catIcon('__icon:'+icon)}function renderCategoryManager(){let cats=document.getElementById('settingsCategories');if(!cats)return;let input=document.getElementById('settingsCategoryInput');let draft=input?input.value:'';let items=(data.categories||[]).slice().sort((a,b)=>a.localeCompare(b));cats.innerHTML=`<div class="categoryManager"><div class="categoryAddRow compactCategoryAdd"><input class="field" id="settingsCategoryInput" placeholder="Category name, e.g. Car" value="${htmlText(draft)}" oninput="settingsCategoryIcon=suggestCategoryIcon(this.value)" onkeydown="if(event.key==='Enter')addCategoryFromSettings()"><button class="backupBtn primary" type="button" onclick="addCategoryFromSettings()">Add</button></div><div class="categoryIconPicker">${categoryIconChoices().map(icon=>`<button type="button" class="categoryIconChoice ${settingsCategoryIcon===icon?'active':''}" onclick="selectCategoryIcon('${icon}')" aria-label="Use ${icon} icon"><span>${categoryIconPreview(icon)}</span></button>`).join('')}</div><div class="categoryHint">Choose an icon, type a label, then add it. The icon appears in transactions, reports, and budgets.</div><div class="categoryChipGrid">${items.map(c=>`<span class="categoryPill improvedCategory"><span class="categoryIcon">${catIcon(c)}</span><span>${htmlText(c)}</span>${defaultCategories().includes(c)?'':`<button type="button" aria-label="Delete ${htmlText(c)}" onclick="deleteCategory('${jsString(c)}')">x</button>`}</span>`).join('')||'<div class="empty">No categories yet.</div>'}</div></div>`}function resetAllData(){if(!confirm('Reset all PesoTrack data on this device?'))return;if(!confirm('This cannot be undone unless you exported a backup. Continue?'))return;data={accounts:[],txns:[],bills:[],recurring:[],budgets:[],categories:['Food','Groceries','Transport','Shopping','Bills','Utilities','Health','Salary','Investment','Debt Payment','Transfer Fees','Subscription','MP2','Other'],categoryIcons:{},settings:{accent:'#6c63ff',privacy:false,weekStart:'1',currency:'PHP',dark:true,pinEnabled:false,pinHash:''}};localStorage.setItem(KEY,JSON.stringify(data));applySettings();render();toastMsg('All data reset')}

/* Premium Edition Phase 2: Motion & Interaction */
(function(){
  const motionValueIds=['safeSpendHero','netWorth','cashTotal','cardTotal','billsDue','todayIncome','todayExpense','todayTransfer','reportIncome','reportExpense','reportNet','healthScoreDash','healthScoreReport'];
  function addPressTargets(){
    document.querySelectorAll('button,.card,.row,.option,.ccCard,.budgetCard').forEach(el=>el.classList.add('pressLift'));
  }
  function pulseChangedValues(){
    motionValueIds.forEach(id=>{
      const el=document.getElementById(id); if(!el) return;
      const txt=el.textContent;
      if(el.dataset.motionLast && el.dataset.motionLast!==txt){
        el.classList.remove('valuePulse'); void el.offsetWidth; el.classList.add('valuePulse');
      }
      el.dataset.motionLast=txt;
    });
  }
  function tagStagger(){
    document.querySelectorAll('.premiumDashboard .timelineItem,.premiumDashboard .row,.premiumDashboard .premiumActions button').forEach((el,i)=>{
      el.style.animationDelay=Math.min(i*35,220)+'ms';
    });
  }
  function afterRenderMotion(){
    addPressTargets(); pulseChangedValues(); tagStagger();
  }
  document.addEventListener('pointerdown',e=>{
    const target=e.target.closest('button'); if(!target || target.disabled) return;
    const rect=target.getBoundingClientRect();
    const ripple=document.createElement('span');
    ripple.className='premiumRipple';
    ripple.style.left=(e.clientX-rect.left)+'px';
    ripple.style.top=(e.clientY-rect.top)+'px';
    ripple.style.width=ripple.style.height=Math.max(rect.width,rect.height)/5+'px';
    target.appendChild(ripple);
    setTimeout(()=>ripple.remove(),650);
  },{passive:true});
  window.addEventListener('load',()=>{
    document.body.classList.add('motion-ready');
    afterRenderMotion();
  });
  const prevRender=window.render;
  if(typeof prevRender==='function'){
    window.render=function(){
      prevRender.apply(this,arguments);
      requestAnimationFrame(afterRenderMotion);
    }
  }
  const prevOpenTxn=window.openTxn;
  if(typeof prevOpenTxn==='function'){
    window.openTxn=function(){
      prevOpenTxn.apply(this,arguments);
      setTimeout(()=>document.getElementById('txnSheet')?.scrollTo({top:0,behavior:'smooth'}),30);
    }
  }
})();


applySettings();
(function wireTransactionSaveButton(){
  try{
    const btn=document.getElementById('txnSaveBtn');
    if(btn && !btn.dataset.wired){
      btn.dataset.wired='1';
      btn.addEventListener('click',function(ev){
        ev.preventDefault();
        if(typeof saveTxn==='function') saveTxn();
      });
    }
  }catch(e){console.warn('Unable to wire Save Transaction button',e)}
})();
render();

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}


// Gold Master Phase 2: safe UI polish hooks
(function(){
  const previousRender = window.render;
  if (typeof previousRender === 'function') {
    window.render = function(){
      previousRender();
      try { gm2EnhanceEmptyStates(); } catch(e) { console.warn('GM2 enhancement skipped', e); }
    };
  }
  window.gm2EnhanceEmptyStates = function(){
    const report = document.getElementById('transactionReport');
    if (report && (!report.textContent || !report.textContent.trim())) {
      report.innerHTML = '<div class="gm2-empty-tip"><b>No matching transactions</b>Try another period or account filter.</div>';
    }
    const upcoming = document.getElementById('upcoming');
    if (upcoming && upcoming.textContent && upcoming.textContent.includes('No unpaid bills')) {
      upcoming.innerHTML = '<div class="gm2-empty-tip"><b>All clear</b>No unpaid bills right now. Credit card bills will appear here automatically.</div>';
    }
  };
  document.addEventListener('click', function(e){
    const btn = e.target.closest('button');
    if (!btn || !btn.classList.contains('save')) return;
    btn.classList.add('valuePulse');
    setTimeout(()=>btn.classList.remove('valuePulse'), 360);
  });
  setTimeout(()=>{ try{ gm2EnhanceEmptyStates(); }catch(e){} }, 80);
})();


// Gold Master Phase 3: Premium Reports & Financial Story
(function(){
  function gm3SafeNum(n){ return Number(n||0) || 0; }
  function gm3InRange(t,start,end){
    try{ const d=new Date(t.date||Date.now()); return d>=start && d<end; }catch(e){ return false; }
  }
  function gm3Period(){
    if(typeof periodStartEnd==='function') return periodStartEnd();
    const now=new Date();
    return {start:new Date(now.getFullYear(),now.getMonth(),1),end:new Date(now.getFullYear(),now.getMonth()+1,1)};
  }
  function gm3AccountName(id){
    try{ return typeof accountLabel==='function' ? accountLabel(id) : ((data.accounts||[]).find(a=>a.id===id)||{}).name || 'Account'; }catch(e){ return 'Account'; }
  }
  function gm3Compute(){
    const {start,end}=gm3Period();
    const acct=(document.getElementById('reportAccount')||{}).value||'All';
    const txns=(data.txns||[]).filter(t=>gm3InRange(t,start,end)).filter(t=>acct==='All'||t.from===acct||t.to===acct);
    let income=0, expense=0, fees=0, transfers=0, cardPayments=0;
    const cats={}; const sources={};
    txns.forEach(t=>{
      const amt=gm3SafeNum(t.amount);
      if(t.type==='Income' && (acct==='All'||t.from===acct)){ income+=amt; sources[t.category||gm3AccountName(t.from)]=(sources[t.category||gm3AccountName(t.from)]||0)+amt; }
      else if(t.type==='Expense' && (acct==='All'||t.from===acct)){ expense+=amt; cats[t.category||'Other']=(cats[t.category||'Other']||0)+amt; }
      else if(t.type==='Transfer'){ const fee=gm3SafeNum(t.fee); transfers+=amt; if(fee && (acct==='All'||t.from===acct)){ expense+=fee; fees+=fee; cats['Transfer Fees']=(cats['Transfer Fees']||0)+fee; } }
      else if(t.type==='Card Payment'){ cardPayments+=amt; }
    });
    const catEntries=Object.entries(cats).sort((a,b)=>b[1]-a[1]);
    return {start,end,acct,txns,income,expense,fees,transfers,cardPayments,cats,sources,catEntries,net:income-expense};
  }
  function gm3MonthName(d){ return d.toLocaleDateString('en-PH',{month:'short',day:'numeric'}); }
  function gm3Set(id,html){ const el=document.getElementById(id); if(el) el.innerHTML=html; }
  function gm3Text(id,text){ const el=document.getElementById(id); if(el) el.textContent=text; }
  window.renderGoldMasterReports = function(){
    if(!document.getElementById('gm3StoryLines')) return;
    const r=gm3Compute();
    const savingsRate=r.income ? Math.round((r.net/r.income)*100) : 0;
    const top=r.catEntries[0] || ['-',0];
    const score = r.income ? (savingsRate>=50?'Excellent':savingsRate>=25?'Strong':savingsRate>=0?'Stable':'Review') : (r.expense?'Spending only':'New');
    gm3Text('gm3ReportRange', `${gm3MonthName(r.start)} - ${gm3MonthName(new Date(r.end-86400000))}`);
    gm3Text('gm3SavingsRate', r.income ? `${savingsRate}%` : '-');
    gm3Text('gm3CashFlow', (r.net>=0?'+':'') + peso(r.net));
    gm3Text('gm3TopCategory', top[0]==='-'?'-':top[0]);
    gm3Text('gm3ActivityCount', `${r.txns.length} ${r.txns.length===1?'entry':'entries'}`);
    const pills=[];
    if(r.income) pills.push(`Income ${peso(r.income)}`);
    if(r.expense) pills.push(`Expense ${peso(r.expense)}`);
    if(r.fees) pills.push(`Fees ${peso(r.fees)}`);
    if(r.cardPayments) pills.push(`Card payments ${peso(r.cardPayments)}`);
    gm3Set('gm3ReportPills', pills.length?pills.map(p=>`<span class="gm3-pill">${p}</span>`).join(''):'<span class="gm3-pill">Add transactions to build your story</span>');
    gm3Text('gm3StoryTitle', reportPeriod==='Today'?'Today at a glance':`${reportPeriod} at a glance`);
    gm3Text('gm3StoryIncome', peso(r.income));
    gm3Text('gm3StoryExpense', peso(r.expense));
    gm3Text('gm3StorySaved', (r.net>=0?'+':'')+peso(r.net));
    gm3Text('gm3StoryScore', score);
    const lines=[];
    if(!r.txns.length){ lines.push(['--','No activity yet for this period. Once you add transactions, PesoTrack will summarize your money story here.']); }
    else{
      lines.push(['IN',`You earned ${peso(r.income)} and spent ${peso(r.expense)} during this period.`]);
      if(r.income) lines.push([r.net>=0?'OK':'!', r.net>=0?`You kept ${peso(r.net)} after expenses (${savingsRate}% savings rate).`:`Expenses exceeded income by ${peso(Math.abs(r.net))}.`]);
      if(top[1]) lines.push(['TOP',`Your biggest spending category was ${top[0]} at ${peso(top[1])}.`]);
      if(r.fees) lines.push(['FE',`Transfer fees totaled ${peso(r.fees)}.`]);
      if(r.cardPayments) lines.push(['CC',`You recorded ${peso(r.cardPayments)} in credit card payments. These are not double-counted as expenses.`]);
    }
    gm3Set('gm3StoryLines', lines.map(([i,t])=>`<div class="gm3-story-line"><i>${i}</i><span>${t}</span></div>`).join(''));
    const catEl=document.getElementById('categoryReport');
    if(catEl && r.catEntries.length){
      const max=Math.max(1,...r.catEntries.map(x=>x[1]));
      catEl.innerHTML=r.catEntries.map(([cat,val])=>`<div class="gm3-category-card"><div><b>${(typeof catIcon==='function'?catIcon(cat):'-')} ${cat}</b><div class="sub">${Math.round((val/Math.max(1,r.expense))*100)}% of spending</div></div><b>${peso(val)}</b><div class="gm3-catbar"><i style="width:${Math.max(5,val/max*100)}%"></i></div></div>`).join('');
    }
  };
  const prev=window.renderReports;
  if(typeof prev==='function'){ window.renderReports=function(){ prev(); try{ renderGoldMasterReports(); }catch(e){ console.warn('GM3 reports skipped', e); } }; }
  setTimeout(()=>{ try{ renderGoldMasterReports(); }catch(e){} },100);
})();


/* Professional hardening pass: keep restored/user-entered data as text. */
function cls(a){if(a&&typeof a==='object')return safeClass(a.logoKey||banks[a.institution]||'otherbank');return safeClass(banks[a]||'otherbank')}
function logo(a){return `<div class="bank ${cls(a)}">${htmlText((a?.institution||a?.name||'?').slice(0,3).toUpperCase(),'?')}</div>`}
function accountLabel(id){let a=data.accounts.find(x=>x.id===id);return a?`${a.name||'Account'} (${a.institution||a.type||'Account'})`:'Unknown account'}
function safeAccountLabel(id){return htmlText(accountLabel(id),'Unknown account')}
function safeDateText(v){return htmlText(v||'')}
function premiumAccountCard(a){
  const isCard=a.type==='Credit Card';
  const amt=accountAmount(a);
  const limit=Number(a.limit||0), out=Number(a.outstanding||0);
  const pct=isCard&&limit?Math.min(100,Math.round(out/limit*100)):0;
  const progClass=pct>=80?'danger':(pct>=50?'warn':'');
  const meta=isCard?`<div class="premiumMetaRow"><span>Limit</span><b>${peso(limit)}</b></div><div class="premiumProgress ${progClass}"><i style="width:${pct}%"></i></div><div class="premiumMetaRow"><span>Due day</span><b>${htmlText(a.dueDay||'-')}</b></div>`:`<div class="premiumMetaRow"><span>${htmlText(accountSubtitleLine(a))}</span><b>${htmlText(a.type||'Account')}</b></div>`;
  return `<div class="premiumAccountCard ${isCard?'credit':''}" onclick="openAccountDetail('${jsString(a.id)}')">
    <div class="premiumAccountTop"><div>${logo(a)}</div><span class="premiumBadge">${htmlText(a.type||'Account')}</span></div>
    <div><div class="premiumAcctName">${htmlText(a.name,'Unnamed Account')}</div><div class="premiumAcctInst">${htmlText(a.institution||a.type||'')}</div></div>
    <div class="premiumValue">${peso(amt)}</div>${meta}
  </div>`;
}

function renderBillCard(b,history=false){
  b.status=billStatus(b);
  let d=daysUntil(b.dueDate),dueText=b.status==='Paid'?'Paid':(d<0?`${Math.abs(d)}d overdue`:d===0?'Due today':`Due in ${d}d`);
  let paid=Math.max(0,(b.amount||0)-(b.remaining||0)),pays=billPayments(b);
  return `<div class="billCard"><div class="billTop"><div><b>${htmlText(b.cardName,'Card Bill')}</b><div class="sub">${htmlText(billPeriod(b))}</div></div><span class="statusPill ${safeClass(b.status)}">${htmlText(b.status)}</span></div><div class="billMeta"><div><span class="small">Statement</span><b>${peso(b.amount)}</b></div><div><span class="small">Remaining</span><b>${peso(b.remaining)}</b></div><div><span class="small">Due date</span><b>${safeDateText(b.dueDate)}</b></div><div><span class="small">${history?'Paid':'Status'}</span><b>${history?peso(paid):htmlText(dueText)}</b></div></div>${pays.length?`<div class="payHistory"><div class="small">Payments</div>${pays.slice(0,3).map(p=>`<div class="historyRow"><span>${txnDate(p)} - ${safeAccountLabel(p.from)}</span><b>${peso(p.amount)}</b></div>`).join('')}</div>`:''}${b.status!=='Paid'?`<button class="save" onclick="openSettle('${jsString(b.id)}')">Settle Bill</button>`:''}</div>`;
}

function renderReportList(target,obj,kind){let entries=Object.entries(obj).sort((a,b)=>b[1]-a[1]);document.getElementById(target).innerHTML=entries.length?entries.map(([k,v])=>`<div class="reportLine"><div><b>${kind==='cat'?catIcon(k)+' ':''}${htmlText(k)}</b><div class="sub">${kind==='acct'?'Selected period activity':'Total for '+reportPeriod.toLowerCase()}</div></div><b>${peso(v)}</b></div>`).join(''):`<div class="reportEmpty">No ${kind==='income'?'income':kind==='cat'?'expenses':'activity'} for this period.</div>`}
function txnSummary(t){let left='',right='',tone='neutral',label=t.type||'Entry';if(t.type==='Income'){left=htmlText(t.category||'Income')+' - Deposit to '+safeAccountLabel(t.from);right='+'+peso(t.amount);tone='income';label='Income'}else if(t.type==='Expense'){left=htmlText(t.category||'Expense')+' - '+safeAccountLabel(t.from);right='-'+peso(t.amount);tone='expense';label='Expense'}else if(t.type==='Transfer'){left=safeAccountLabel(t.from)+' to '+safeAccountLabel(t.to)+(Number(t.fee||0)?' - Fee '+peso(t.fee):'');right=peso(t.amount);tone='transfer';label='Transfer'}else if(t.type==='Card Payment'){left=safeAccountLabel(t.from)+' to '+safeAccountLabel(t.to);right='Paid '+peso(t.amount);tone='payment';label='Payment'}return {left,right,tone,label}}
function renderSettings(){if(document.getElementById('weekStart'))weekStart.value=String(data.settings.weekStart??'1');if(document.getElementById('currencySetting'))currencySetting.value=data.settings.currency||'PHP';renderCategoryManager()}

/* Reports fix: transaction list follows selected period and account. */
function renderTransactionsList(){
  let el=document.getElementById('transactionReport');
  if(!el)return;
  let q=(document.getElementById('txnSearch')?.value||'').trim();
  let {start,end}=periodStartEnd();
  let acct=(document.getElementById('reportAccount')||{}).value||'All';
  let arr=data.txns
    .filter(t=>txInPeriod(t,start,end))
    .filter(t=>acct==='All'||t.from===acct||t.to===acct)
    .slice()
    .reverse()
    .filter(t=>txnMatches(t,q))
    .slice(0,80);
  let periodLabel=reportPeriod==='Today'?'today':`this ${reportPeriod.toLowerCase()}`;
  el.innerHTML=arr.length?arr.map(t=>txnRow(t)).join(''):`<div class="reportEmpty">No transactions ${q?`match "${htmlText(q)}" `:''}for ${periodLabel}${acct==='All'?'':' in this account'}.</div>`;
}

/* Reports period navigation: previous/next day, week, month, year. */
let reportOffset=0;
function periodStartEnd(){
  let now=new Date(),start,end;
  if(reportPeriod==='Today'){
    start=new Date(now.getFullYear(),now.getMonth(),now.getDate()+reportOffset);
    end=new Date(start.getFullYear(),start.getMonth(),start.getDate()+1);
  }else if(reportPeriod==='Week'){
    let mondayOffset=(now.getDay()+6)%7;
    start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-mondayOffset+(reportOffset*7));
    end=new Date(start.getFullYear(),start.getMonth(),start.getDate()+7);
  }else if(reportPeriod==='Year'){
    start=new Date(now.getFullYear()+reportOffset,0,1);
    end=new Date(start.getFullYear()+1,0,1);
  }else{
    start=new Date(now.getFullYear(),now.getMonth()+reportOffset,1);
    end=new Date(start.getFullYear(),start.getMonth()+1,1);
  }
  return {start,end};
}
function reportPeriodTitle(){
  const {start,end}=periodStartEnd();
  if(reportPeriod==='Today')return start.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});
  if(reportPeriod==='Week'){
    const last=new Date(end);last.setDate(last.getDate()-1);
    return `${start.toLocaleDateString('en-PH',{month:'short',day:'numeric'})} - ${last.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}`;
  }
  if(reportPeriod==='Year')return String(start.getFullYear());
  return start.toLocaleDateString('en-PH',{month:'long',year:'numeric'});
}
function ensureReportPeriodNav(){
  const reports=document.getElementById('reports'),tabs=document.querySelector('#reports .reportTabs');
  if(!reports||!tabs||document.getElementById('reportPeriodNav'))return;
  const nav=document.createElement('div');
  nav.id='reportPeriodNav';
  nav.className='reportPeriodNav';
  nav.innerHTML=`<button type="button" onclick="shiftReportPeriod(-1)" aria-label="Previous period">&lt;</button><b id="reportPeriodLabel"></b><button type="button" onclick="shiftReportPeriod(1)" aria-label="Next period">&gt;</button>`;
  tabs.parentNode.insertBefore(nav,tabs);
}
function updateReportPeriodLabel(){
  const label=document.getElementById('reportPeriodLabel');
  if(label)label.textContent=reportPeriodTitle();
  const range=document.getElementById('gm3ReportRange');
  if(range)range.textContent=reportPeriodTitle();
}
function shiftReportPeriod(delta){reportOffset+=delta;renderReports();}
function setReportPeriod(p,el){
  reportPeriod=p;
  reportOffset=0;
  document.querySelectorAll('.reportTabs button').forEach(b=>b.classList.remove('active'));
  if(el)el.classList.add('active');
  renderReports();
}

const reportNavPreviousRender=window.renderReports;
window.renderReports=function(){
  ensureReportPeriodNav();
  if(typeof reportNavPreviousRender==='function')reportNavPreviousRender();
  updateReportPeriodLabel();
  renderTransactionsList();
};

/* Reports hierarchy: keep transactions as the final report section. */
function moveTransactionsToReportEnd(){
  const report=document.getElementById('transactionReport');
  if(!report)return;
  const txnPanel=report.closest('.reportPanel');
  const reports=document.getElementById('reports');
  if(txnPanel&&reports&&txnPanel.parentNode===reports&&reports.lastElementChild!==txnPanel){
    reports.appendChild(txnPanel);
  }
}

/* Reports cleanup: focused views, fewer duplicate analytics panels. */
(function(){
  function panelByTitle(title){
    return [...document.querySelectorAll('#reports .reportPanel')].find(p=>p.querySelector('h3')?.textContent.trim()===title);
  }
  function setHidden(el,hidden){ if(el)el.classList.toggle('reportHidden',!!hidden); }
  function applyReportsCleanup(){
    setHidden(document.querySelector('#reports .gm3-story'),true);
    setHidden(document.getElementById('analyticsHealthHero'),true);
    setHidden(panelByTitle('Analytics & Insights'),true);
    setHidden(panelByTitle('Premium Analytics'),true);
    setHidden(panelByTitle('Top Categories'),true);
    setHidden(panelByTitle('Backup / Restore'),true);
    setHidden(panelByTitle('Income Sources'),true);
    setHidden(panelByTitle('Account Activity'),true);


    const panels={
      txns:panelByTitle('Transactions'),
      cash:panelByTitle('Cash Flow'),
      cats:panelByTitle('Spending by Category'),
      budgets:panelByTitle('Monthly Budgets'),
      insights:panelByTitle('Smart Insights')
    };
    Object.values(panels).forEach(p=>setHidden(p,true));
    setHidden(panels.cash,false);
    setHidden(panels.cats,false);
    setHidden(panels.insights,false);
    setHidden(panels.budgets,false);
    setHidden(panels.txns,false);
    moveTransactionsToReportEnd();
  }
  const previous=window.renderReports;
  window.renderReports=function(){
    if(typeof previous==='function')previous();
    applyReportsCleanup();
  };
window.addEventListener('load',()=>setTimeout(()=>{try{applyReportsCleanup();}catch(e){}},260));
})();

/* Reports clarity pass: period controls drive every report view. */
(function(){
  function selectedReportTxns(){
    const {start,end}=periodStartEnd();
    return (data.txns||[]).filter(t=>txInPeriod(t,start,end));
  }
  function syncReportPeriodButtons(){
    document.querySelectorAll('#reports .reportTabs button').forEach(btn=>{
      const text=btn.textContent.trim();
      const period=text==='Day'?'Today':text;
      btn.classList.toggle('active',period===reportPeriod);
    });
  }
  function reorderReportControls(){
    const reports=document.getElementById('reports');
    const periodTabs=document.querySelector('#reports .reportTabs');
    const nav=document.getElementById('reportPeriodNav');
    const hero=document.querySelector('#reports .gm3-reportHero');
    if(!reports||!periodTabs)return;
    const anchor=reports.querySelector('.accountFilter')||hero;
    reports.insertBefore(periodTabs,anchor);
    if(nav)reports.insertBefore(nav,periodTabs.nextSibling);
  }
  function ensureReportScopeNote(){
    const reports=document.getElementById('reports');
    const hero=document.querySelector('#reports .gm3-reportHero');
    if(!reports||!hero)return null;
    let note=document.getElementById('reportScopeNote');
    if(!note){
      note=document.createElement('div');
      note.id='reportScopeNote';
      note.className='reportScopeNote';
      hero.parentNode.insertBefore(note,hero.nextSibling);
    }
    return note;
  }
  function monthLabelForSelectedPeriod(){
    const {start}=periodStartEnd();
    return start.toLocaleDateString('en-PH',{month:'long',year:'numeric'});
  }
  function renderBudgetReportForSelectedMonth(){
    const el=document.getElementById('budgetReport');
    if(!el)return;
    const panel=el.closest('.reportPanel');
    if(panel){
      panel.classList.add('budgetCollapsed');
      const h=panel.querySelector('h3');
      if(h)h.textContent='Monthly Budgets';
      let head=panel.querySelector('.panelHead');
      if(head&&!head.querySelector('.budgetToggleBtn')){
        const toggle=document.createElement('button');
        toggle.type='button';
        toggle.className='tiny budgetToggleBtn';
        toggle.textContent='Show';
        toggle.onclick=function(){
          panel.classList.toggle('budgetOpen');
          toggle.textContent=panel.classList.contains('budgetOpen')?'Hide':'Show';
        };
        head.insertBefore(toggle,head.querySelector('button'));
      }
    }
    const {start}=periodStartEnd();
    const mStart=new Date(start.getFullYear(),start.getMonth(),1);
    const mEnd=new Date(start.getFullYear(),start.getMonth()+1,1);
    const spend={};
    (data.txns||[]).filter(t=>txInPeriod(t,mStart,mEnd)).forEach(t=>{
      if(t.type==='Expense')groupAdd(spend,t.category||'Other',Number(t.amount||0));
      if(t.type==='Transfer'&&Number(t.fee||0))groupAdd(spend,'Transfer Fees',Number(t.fee||0));
    });
    const arr=data.budgets||[];
    const monthName=monthLabelForSelectedPeriod();
    el.innerHTML=arr.length?arr.map(b=>{
      const used=Number(spend[b.category]||0),limit=Number(b.amount||0),pct=limit?Math.round((used/limit)*100):0,barClass=pct>=100?'danger':pct>=80?'warn':'';
      return `<div class="budgetCard"><div class="budgetTop"><div><b>${catIcon(b.category)} ${htmlText(b.category)}</b><div class="sub">${htmlText(monthName)} monthly limit ${peso(limit)}</div></div><span class="budgetPct">${pct}%</span></div><div class="budgetBar ${barClass}"><i style="width:${Math.min(100,pct)}%"></i></div><div class="budgetMeta"><span>Used ${peso(used)}</span><span>Left ${peso(Math.max(0,limit-used))}</span></div><div class="budgetActions"><button class="tiny" onclick="openBudget('${jsString(b.id)}')">Edit</button><button class="tiny danger" onclick="deleteBudget('${jsString(b.id)}')">Delete</button></div></div>`;
    }).join(''):`<div class="reportEmpty">No budgets yet. Budgets are monthly, so they follow the month that contains the selected period.</div>`;
  }
  function updateReportsScope(){
    syncReportPeriodButtons();
    reorderReportControls();
    try{moveTransactionsToReportEnd();}catch(e){}
    const cashPanel=[...document.querySelectorAll('#reports .reportPanel')].find(p=>p.querySelector('h3')?.textContent.trim()==='Cash Flow');
    if(cashPanel){
      const h=cashPanel.querySelector('h3');
      if(h)h.textContent='Income vs Expense';
    }
    const note=ensureReportScopeNote();
    const count=selectedReportTxns().length;
    if(note){
      note.innerHTML=`<b>${htmlText(reportPeriodTitle())}</b>${count} transaction${count===1?'':'s'} in this period. Spending, insights, and transactions use this selected range.`;
    }
    renderBudgetReportForSelectedMonth();
  }
  const previous=window.renderReports;
  window.renderReports=function(){
    if(typeof previous==='function')previous();
    updateReportsScope();
  };
  window.addEventListener('load',()=>setTimeout(()=>{try{updateReportsScope();}catch(e){}},360));
})();

/* Bills support: shared setup styling and card-account shortcut. */
(function(){
  window.openAddCreditCard=function(){
    openAddAccount();
    setTimeout(()=>{try{if(document.getElementById('atype')){atype.value='Credit Card';renderAccountFields();}}catch(e){}},0);
  };
})();
/* PM Home pass: daily control room instead of mini report. */
(function(){
  const css=document.createElement('style');
  css.textContent=`
    #dashboard.pmHome .premiumHero{border-radius:28px;padding:18px;margin-bottom:12px}
    #dashboard.pmHome .premiumHeroMain,#dashboard.pmHome .premiumMetrics{display:none!important}
    #dashboard.pmHome .premiumCashBlock{display:block;margin-top:0}
    #dashboard.pmHome .premiumCash{font-size:40px;margin:7px 0 4px}
    #dashboard.pmHome .premiumHero .label:before{content:"Ready to use";font-size:12px;color:rgba(243,239,228,.66)}
    #dashboard.pmHome .premiumHero .label{font-size:0}
    #dashboard.pmHome .premiumHero .heroSub{max-width:260px}
    #dashboard.pmHome .premiumHero .dashPill{display:inline-flex;margin-top:12px}
    #dashboard.pmHome .premiumSummaryChips{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:14px}
    #dashboard.pmHome .premiumSummaryChips button{padding:10px;border-radius:16px}
    #dashboard.pmHome .premiumSummaryChips span{display:none}
    #dashboard.pmHome .premiumSummaryChips b{font-size:12px;text-align:center}
    .pmPriorityCard{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:22px;padding:15px;margin:12px 0 14px;box-shadow:0 10px 28px rgba(18,24,40,.07)}
    .pmPriorityTop{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .pmPriorityLabel{font-size:11px;font-weight:950;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
    .pmPriorityCard h2{font-size:18px;line-height:1.15;margin:4px 0 5px;letter-spacing:-.025em}
    .pmPriorityCard p{margin:0;color:var(--muted);font-size:13px;font-weight:750;line-height:1.35}
    .pmPriorityCard button{border:0;border-radius:16px;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;font-weight:950;padding:11px 13px;white-space:nowrap;box-shadow:0 10px 24px color-mix(in srgb,var(--accent) 24%,transparent)}
    #dashboard.pmHome .premiumSection{margin-top:18px}
    #dashboard.pmHome .premiumSection h2{font-size:18px}
    #dashboard.pmHome #upcoming .premiumTimelineItem:nth-child(n+4){display:none}
    #dashboard.pmHome #recent .row:nth-child(n+5){display:none}body.dark .pmPriorityCard{background:var(--pt-dark-surface);border-color:var(--pt-dark-border);box-shadow:0 14px 34px rgba(0,0,0,.22)}
    body.dark .pmPriorityCard p{color:var(--pt-dark-muted)}
  `;
  document.head.appendChild(css);

  function navButton(index){ return document.querySelectorAll('.nav button')[index]||null; }
  function placePriorityCard(){
    const dash=document.getElementById('dashboard');
    document.getElementById('pmPriorityCard')?.remove();
    return null;
  }
  function priorityModel(){
    const unpaid=(data.bills||[]).filter(b=>b.status!=='Paid').slice().sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate));
    const next=unpaid[0], dueDays=next?daysUntil(next.dueDate):null;
    const today=todaysRange();
    const todayCount=(data.txns||[]).filter(t=>{const d=new Date(t.date||Date.now());return d>=today.start&&d<today.end;}).length;
    if(!(data.accounts||[]).length){
      return {label:'Setup',title:'Add your first account',body:'Start with the bank, wallet, card, or cash account you check most often.',cta:'Add account',action:"openAddAccount()"};
    }
    if(next&&dueDays<=0){
      return {label:'Urgent',title:`${next.cardName||'A bill'} needs attention`,body:`${peso(next.remaining||next.amount||0)} is ${dueDays<0?'overdue':'due today'}. Handle this before reviewing anything else.`,cta:'Open bills',action:"go('bills',navButton(3))"};
    }
    if(next&&dueDays<=3){
      return {label:'Upcoming',title:`Prepare for ${next.cardName||'your next bill'}`,body:`${peso(next.remaining||next.amount||0)} is due in ${dueDays} day${dueDays===1?'':'s'}. Keep that cash separate.`,cta:'View bills',action:"go('bills',navButton(3))"};
    }
    if(!todayCount){
      return {label:'Today',title:'Record your first transaction today',body:'A quick entry keeps the Home screen honest and makes Reports useful later.',cta:'Add transaction',action:'openTxn()'};
    }
    return {label:'Review',title:'You are up to date today',body:'Check the latest activity, then only go deeper if something looks off.',cta:'View reports',action:"go('reports',navButton(4))"};
  }
  window.pmHomeAction=function(action){
    try{ new Function('navButton',action)(navButton); }catch(e){ console.warn('PM action skipped',e); }
  };
  function updatePmHome(){
    const dash=document.getElementById('dashboard');
    if(!dash)return;
    dash.classList.add('pmHome');
    const card=placePriorityCard();
    const model=priorityModel();
    if(card){
      card.innerHTML=`<div class="pmPriorityTop"><div><div class="pmPriorityLabel">${htmlText(model.label)}</div><h2>${htmlText(model.title)}</h2><p>${htmlText(model.body)}</p></div><button type="button" onclick="pmHomeAction('${jsString(model.action)}')">${htmlText(model.cta)}</button></div>`;
    }
    const date=document.getElementById('dashDate');
    if(date)date.textContent='Today, '+new Date().toLocaleDateString('en-PH',{month:'short',day:'numeric'});
    const safeHint=document.getElementById('safeSpendHint');
    if(safeHint)safeHint.textContent='After unpaid bills are set aside';
  }
  const prevRender=window.render;
  window.render=function(){
    if(typeof prevRender==='function')prevRender();
    try{updatePmHome();}catch(e){console.warn('PM home pass skipped',e)}
  };
  window.addEventListener('load',()=>setTimeout(()=>{try{updatePmHome();}catch(e){}},340));
})();

/* Accounts glimpse pass: compact rows first, detail sheet on tap. */
(function(){
  const css=document.createElement('style');
  css.textContent=`
    #accounts #accountGrid{display:block!important}
    #accounts > .chips{display:none!important}
    #accounts .acctGroup{margin:0 0 16px}
    #accounts .acctGroupHead{width:100%;border:0;background:transparent;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px;padding:0 2px;text-align:left}
    #accounts .acctGroupName{font-size:13px;font-weight:950;color:var(--text)}
    #accounts .acctGroupHead span{font-size:11px;color:var(--muted);font-weight:850;white-space:nowrap}
    #accounts .acctGroupHead .acctChevron{color:var(--accent-2);font-size:14px;font-weight:950;margin-left:6px}
    #accounts .acctGroupTitle{display:flex;align-items:center;gap:7px;min-width:0}
    #accounts .acctGroup.collapsed .acctList{display:none}
    #accounts .acctGroup.collapsed{margin-bottom:10px}
    #accounts .acctList{display:grid;gap:8px}
    #accounts .acctRow{width:100%;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:18px;padding:10px 11px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;text-align:left;box-shadow:0 8px 20px rgba(0,0,0,.08)}
    #accounts .acctRow .bank{width:34px;height:34px;border-radius:13px;font-size:10px;margin:0}
    #accounts .acctMain{min-width:0}
    #accounts .acctName{display:block;font-size:14px;font-weight:950;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #accounts .acctMeta{display:block;margin-top:4px;min-width:0}
    #accounts .acctInst{font-size:11px;color:var(--muted);font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #accounts .acctRight{text-align:right;min-width:88px}
    #accounts .acctAmount{display:block;font-size:16px;font-weight:950;line-height:1.1;font-variant-numeric:tabular-nums}
    #accounts .acctHint{display:block;font-size:10px;color:var(--muted);font-weight:850;margin-top:4px;white-space:nowrap}
    #accounts .acctUtil{height:5px;background:var(--card-inset,rgba(255,255,255,.07));border-radius:999px;overflow:hidden;margin-top:6px}
    #accounts .acctUtil i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-2));border-radius:999px}
    #accounts .acctUtil.warn i{background:var(--orange)}
    #accounts .acctUtil.danger i{background:var(--red)}
    #accounts .top .iconbtn{display:none!important}
    #accounts .acctAddRow{border-style:dashed;grid-template-columns:auto 1fr;background:color-mix(in srgb,var(--card) 90%,var(--bg))}
    #accounts .acctAddIcon{width:34px;height:34px;border-radius:13px;display:grid;place-items:center;background:var(--card-inset,rgba(255,255,255,.07));color:var(--accent-2);font-size:18px;font-weight:950}
    @media(max-width:370px){#accounts .acctRow{grid-template-columns:auto minmax(0,1fr);padding:10px}#accounts .acctRight{grid-column:2;text-align:left;min-width:0}#accounts .acctAmount{font-size:15px}#accounts .acctHint{display:inline-block;margin-right:8px}}
  `;
  document.head.appendChild(css);

  function accountGroupLabel(type){
    return type==='Savings'?'Banks':type==='Credit Card'?'Cards':type==='Wallet'?'E-Wallets':type==='Cash'?'Cash':type==='Investment'?'Investments':'Other';
  }
  function accountGlimpseAmount(a){return a.type==='Credit Card'?Number(a.outstanding||0):Number(a.balance||0)}
  function accountGlimpseHint(a){
    if(a.type==='Credit Card'){
      const limit=Number(a.limit||0), out=Number(a.outstanding||0);
      return limit?`${Math.round(out/limit*100)}% used`:'Outstanding';
    }
    if(a.type==='Cash')return 'On hand';
    if(a.type==='Wallet')return 'Wallet';
    if(a.type==='Investment')return 'Value';
    return 'Balance';
  }
  function accountRow(a){
    const amount=accountGlimpseAmount(a);
    const limit=Number(a.limit||0), out=Number(a.outstanding||0);
    const util=a.type==='Credit Card'&&limit?Math.min(100,Math.round(out/limit*100)):0;
    const utilClass=util>=80?'danger':util>=50?'warn':'';
    const utilBar=a.type==='Credit Card'&&limit?`<div class="acctUtil ${utilClass}"><i style="width:${util}%"></i></div>`:'';
    return `<button type="button" class="acctRow" onclick="openAccountDetail('${jsString(a.id)}')">
      ${logo(a)}
      <span class="acctMain"><b class="acctName">${htmlText(a.name,'Unnamed Account')}</b><span class="acctMeta"><span class="acctInst">${htmlText(a.institution||a.type||'Account')}</span></span></span>
      <span class="acctRight"><b class="acctAmount">${peso(amount)}</b><span class="acctHint">${htmlText(accountGlimpseHint(a))}</span>${utilBar}</span>
    </button>`;
  }
  function renderAccountRows(){
    const grid=document.getElementById('accountGrid');
    if(!grid)return;
    const arr=data.accounts.filter(a=>acctFilter==='All'||a.type===acctFilter);
    const order=['Savings','Cash','Wallet','Credit Card','Investment'];
    const groups={};
    arr.forEach(a=>{const key=order.includes(a.type)?a.type:'Other';(groups[key]||(groups[key]=[])).push(a)});
    const sections=order.concat('Other').filter(k=>groups[k]?.length).map(k=>{
      const total=groups[k].reduce((s,a)=>s+accountGlimpseAmount(a),0);
      return `<section class="acctGroup" data-acct-group="${htmlText(k)}"><button type="button" class="acctGroupHead" onclick="toggleAcctGroup('${jsString(k)}')"><span class="acctGroupTitle"><span class="acctGroupName">${accountGroupLabel(k)}</span><i class="acctChevron">-</i></span><span>${groups[k].length} account${groups[k].length===1?'':'s'} - ${peso(total)}</span></button><div class="acctList">${groups[k].map(accountRow).join('')}</div></section>`;
    }).join('');
    grid.innerHTML=(sections||'<div class="gm4-empty"><b>No accounts yet.</b>Tap + to add banks, cash on hand, wallets, cards, or investments.</div>')+`<button type="button" class="acctRow acctAddRow" onclick="openAddAccount()"><span class="acctAddIcon">+</span><span class="acctMain"><b class="acctName">Add Account</b><span class="acctInst">Bank, cash, wallet, card, or investment</span></span></button>`;
    (data.settings.collapsedAccountGroups||[]).forEach(k=>{
      const sec=[...grid.querySelectorAll('[data-acct-group]')].find(x=>x.dataset.acctGroup===k);
      if(sec){sec.classList.add('collapsed');const chev=sec.querySelector('.acctChevron');if(chev)chev.textContent='+';}
    });
  }
  window.toggleAcctGroup=function(k){
    data.settings.collapsedAccountGroups=Array.isArray(data.settings.collapsedAccountGroups)?data.settings.collapsedAccountGroups:[];
    const set=new Set(data.settings.collapsedAccountGroups);
    if(set.has(k))set.delete(k);else set.add(k);
    data.settings.collapsedAccountGroups=[...set];
    try{localStorage.setItem(KEY,JSON.stringify(data))}catch(e){}
    renderAccountRows();
  };
  window.renderAccounts=renderAccountRows;
})();

(function(){
  function esc(v){return String(v??'').replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]})}
  function js(v){return String(v??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}
  function safePeso(v){try{return peso(v)}catch(e){return '\u20b1'+Number(v||0).toLocaleString('en-PH')}}
  function safeStatus(b){try{return billStatus(b)}catch(e){return Number(b.remaining||0)>0?'Unpaid':'Paid'}}
  function safeStatusClass(s){try{return statusClass(s)}catch(e){return String(s||'unpaid').toLowerCase()}}
  function safePeriod(b){try{return billPeriod(b)}catch(e){return [b.periodStart,b.periodEnd||b.statementDate].filter(Boolean).join(' - ')||'Statement'}}
  function safeDate(v){try{return displayDate(v)}catch(e){return String(v||'Add')}}
  function norm(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'')}
  function creditAccounts(){return (data.accounts||[]).filter(function(a){var hay=[a.type,a.name,a.institution].join(' ');return a.type==='Credit Card'||/credit|card|visa|master|amex/i.test(hay)||Number(a.limit||0)>0||Number(a.statementDay||0)>0||Number(a.dueDay||0)>0})}
  function accountForBill(b,accounts){
    var card=norm(b.cardName);
    return accounts.find(function(a){return b.cardId&&a.id===b.cardId})||
      accounts.find(function(a){return card&&(norm(a.name)===card||norm(a.institution)===card)})||
      accounts.find(function(a){var n=norm(a.name),i=norm(a.institution);return card&&((n&&n.indexOf(card)>-1)||(n&&card.indexOf(n)>-1)||(i&&i.indexOf(card)>-1)||(i&&card.indexOf(i)>-1))})
  }
  function nextStatementSafe(a){try{return a?nextStatementDate(a):null}catch(e){return null}}
  function nextDueSafe(a,statement){try{return a?dueFromStatement(a,statement):null}catch(e){return null}}
  function forceBillCreditCenter(){
    var el=document.getElementById('creditCenter');
    if(!el||typeof data==='undefined'||!Array.isArray(data.bills)||!data.bills.length)return;
    var groups={},groupAccounts={},accounts=creditAccounts();
    data.bills.forEach(function(b){
      var acct=accountForBill(b,accounts);
      var key=acct?acct.id:(b.cardId||b.cardName||'Credit Card');
      (groups[key]||(groups[key]=[])).push(b);
      if(acct)groupAccounts[key]=acct;
    });
    var cards=Object.keys(groups).map(function(key){
      var rows=groups[key].slice().sort(function(a,b){return new Date(a.dueDate)-new Date(b.dueDate)});
      var open=rows.find(function(b){return safeStatus(b)!=='Paid'})||rows[0]||{};
      var acct=groupAccounts[key]||accounts.find(function(a){return a.id===key})||accountForBill(open,accounts);
      var title=acct?(acct.name||acct.institution||open.cardName||key):(open.cardName||key||'Credit Card');
      var institution=acct?(acct.institution||'Credit Card'):'Statement record';
      var remaining=rows.filter(function(b){return safeStatus(b)!=='Paid'}).reduce(function(s,b){return s+Number(b.remaining||0)},0);
      var statement=acct?nextStatementSafe(acct):(open.statementDate||open.periodEnd||open.dueDate);
      var due=acct?(open.dueDate||nextDueSafe(acct,statement)):open.dueDate;
      var limit=acct?Number(acct.limit||0):0;
      var outstanding=remaining||Number(open.remaining||0)||0;
      var available=limit?Math.max(0,limit-outstanding):0;
      var dd=due?(function(){var today=new Date();today.setHours(0,0,0,0);var d=new Date(due);d.setHours(0,0,0,0);return Math.ceil((d-today)/86400000)})():null;
      var pill=dd===null?'Statement':(dd<0?'Overdue':dd===0?'Due today':dd+'d left');
      var rowsHtml=rows.slice(0,4).map(function(b){
        var st=safeStatus(b);
        return '<div class="ccStatementMini compactStatement"><div><b class="statementPeriod">'+esc(typeof compactBillPeriod==='function'?compactBillPeriod(b):safePeriod(b))+'</b><span class="sub">Due '+esc(b.dueDate?safeDate(b.dueDate):'Add')+'</span></div><div class="statementAmt"><b>'+safePeso(b.remaining||0)+'</b><span class="statusPill '+safeStatusClass(st)+'">'+esc(st)+'</span></div></div>';
      }).join('');
      var settle=open.id&&safeStatus(open)!=='Paid'?'<button class="primary" onclick="openSettle(\''+js(open.id)+'\')">Settle</button>':'<button class="primary" onclick="closeSheets();openTxn()">Add Purchase</button>';
      var details=acct?'<button onclick="openAccountDetail(\''+js(acct.id)+'\')">Details</button>':'<button onclick="openAddCreditCard()">Create Account</button>';
      return '<div class="premiumCreditCard"><div class="premiumCreditHeader"><div class="premiumCreditLeft"><div class="bank otherbank">CC</div><div style="min-width:0"><div class="premiumCreditTitle">'+esc(title)+'</div><div class="premiumCreditSub">'+esc(institution)+' - '+esc(due?'Due '+safeDate(due):'Statement history')+'</div></div></div><span class="premiumDuePill">'+esc(pill)+'</span></div><div class="premiumCreditBody"><div class="premiumCreditMain"><span>Outstanding</span><b>'+safePeso(outstanding)+'</b><div class="premiumMetaRow" style="margin-top:9px"><span>'+rows.length+' statement'+(rows.length===1?'':'s')+'</span><span>'+esc(acct?'From account':'From bills')+'</span></div></div><div class="premiumCreditSide"><div><span>Limit</span><b>'+esc(limit?safePeso(limit):'Add')+'</b></div><div><span>Available</span><b>'+esc(limit?safePeso(available):'Add')+'</b></div><div><span>Statement</span><b>'+esc(statement?safeDate(statement):'Add')+'</b></div><div><span>Due date</span><b>'+esc(due?safeDate(due):'Add')+'</b></div></div></div><div class="ccStatementList">'+rowsHtml+'</div><div class="premiumCreditActions">'+details+settle+'</div></div>';
    }).join('');
    if(cards)el.innerHTML=cards;
  }
  window.forceBillCreditCenter=forceBillCreditCenter;
  var oldRenderBills=window.renderBills;
  window.renderBills=function(){if(typeof oldRenderBills==='function')oldRenderBills();forceBillCreditCenter();};
  try{renderBills=window.renderBills}catch(e){}
  var oldRender=window.render;
  window.render=function(){if(typeof oldRender==='function')oldRender();setTimeout(forceBillCreditCenter,0);};
  try{render=window.render}catch(e){}
  var oldGo=window.go;
  window.go=function(id,btn){if(typeof oldGo==='function')oldGo(id,btn);if(id==='bills')setTimeout(forceBillCreditCenter,0);};
  try{go=window.go}catch(e){}
  window.addEventListener('load',function(){setTimeout(forceBillCreditCenter,350);setTimeout(forceBillCreditCenter,900)});
})();

/* Category manager: Settings editor and typed transaction categories. */
(function(){
  var oldRenderSettings=window.renderSettings;
  window.renderSettings=function(){
    if(typeof oldRenderSettings==='function')oldRenderSettings();
    try{renderCategoryManager()}catch(e){console.warn('Category manager skipped',e)}
  };
  try{renderSettings=window.renderSettings}catch(e){}
})();

(function(){try{var p=new URLSearchParams(location.search);var action=p.get("action");if(!action)return;window.addEventListener("load",function(){setTimeout(function(){try{if(action==="add"&&typeof openTxn==="function")openTxn();else if(action==="accounts"&&typeof go==="function")go("accounts",document.querySelectorAll(".nav button")[1]);else if(action==="reports"&&typeof go==="function")go("reports",document.querySelectorAll(".nav button")[4]);}catch(e){}},280)});}catch(e){}})();

(function expenseBreakdownAtAGlance(){
  function esc(v){return typeof htmlText==='function'?htmlText(v):String(v==null?'':v).replace(/[&<>'"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]})}
  function expenseDataForRange(range,acct){
    var cats={},count=0,total=0;
    (data.txns||[]).forEach(function(t){
      if(typeof txInPeriod==='function'&&!txInPeriod(t,range.start,range.end))return;
      if(!(acct==='All'||t.from===acct||t.to===acct))return;
      if(t.type==='Expense'&&(acct==='All'||t.from===acct)){
        var amount=Number(t.amount||0); if(!amount)return;
        cats[t.category||'Other']=(cats[t.category||'Other']||0)+amount; total+=amount; count++;
      }
      if(t.type==='Transfer'&&Number(t.fee||0)&&(acct==='All'||t.from===acct)){
        var fee=Number(t.fee||0);
        cats['Transfer Fees']=(cats['Transfer Fees']||0)+fee; total+=fee; count++;
      }
    });
    var entries=Object.entries(cats).sort(function(a,b){return b[1]-a[1]});
    return {entries:entries,total:total,count:count,range:range};
  }
  function previousExpenseRange(range){
    var start=new Date(range.start),end=new Date(range.end);
    if(reportPeriod==='Year')return {start:new Date(start.getFullYear()-1,0,1),end:new Date(start.getFullYear(),0,1)};
    if(reportPeriod==='Month')return {start:new Date(start.getFullYear(),start.getMonth()-1,1),end:new Date(start.getFullYear(),start.getMonth(),1)};
    var days=Math.round((end-start)/86400000)||1;
    return {start:new Date(start.getTime()-days*86400000),end:new Date(end.getTime()-days*86400000)};
  }
  function compareLabel(current,previous){
    current=Number(current||0);previous=Number(previous||0);
    var diff=current-previous;
    if(!previous&&current)return {text:'New',tone:'up',icon:'+'};
    if(previous&&!current)return {text:peso(previous),tone:'down',icon:'↓'};
    if(Math.abs(diff)<0.01)return {text:'Same',tone:'same',icon:'='};
    return {text:peso(Math.abs(diff)),tone:diff>0?'up':'down',icon:diff>0?'↑':'↓'};
  }
  function selectedExpenseData(){
    var range=typeof periodStartEnd==='function'?periodStartEnd():(function(){var now=new Date();return {start:new Date(now.getFullYear(),now.getMonth(),1),end:new Date(now.getFullYear(),now.getMonth()+1,1)}})();
    var acct=(document.getElementById('reportAccount')||{}).value||'All';
    var current=expenseDataForRange(range,acct);
    var previous=expenseDataForRange(previousExpenseRange(range),acct);
    current.previousCats=Object.fromEntries(previous.entries);
    return current;
  }
  window.renderExpenseBreakdown=function(){
    var el=document.getElementById('categoryReport');
    if(!el)return;
    var d=selectedExpenseData();
    var label=typeof reportPeriodTitle==='function'?reportPeriodTitle():(reportPeriod||'This period');
    if(!d.entries.length){
      el.innerHTML='<div class="expenseEmpty"><b>No expenses for '+esc(label)+'.</b><br>Add expense transactions and this section will show where the money went.</div>';
      return;
    }
    var max=Math.max(1,d.entries[0][1]);
    var top=d.entries[0];
    var visibleEntries=d.entries.slice(0,5);
    var rest=d.entries.slice(5).reduce(function(sum,pair){return sum+pair[1]},0);
    if(rest)visibleEntries.push(['Other',rest]);
    var rows=visibleEntries.map(function(pair){
      var cat=pair[0],val=pair[1],pct=Math.round((val/Math.max(1,d.total))*100),width=Math.max(5,Math.round((val/max)*100));
      var icon=typeof catIcon==='function'?catIcon(cat):'';
      var comparison=compareLabel(val,(d.previousCats||{})[cat]);
      return '<div class="expenseBarRow"><div class="expenseBarTop"><b>'+icon+' '+esc(cat)+'</b><strong>'+peso(val)+'</strong></div><div class="expenseTrack"><i style="width:'+width+'%"></i></div><div class="expenseBarMeta"><span>'+pct+'% of expenses</span><span class="expenseCompare '+comparison.tone+'"><i>'+esc(comparison.icon)+'</i>'+esc(comparison.text)+'</span><span>'+esc(label)+'</span></div></div>';
    }).join('');
    el.innerHTML='<div class="expenseBreakdownSummary"><div class="expenseStat"><span>Total spent</span><b>'+peso(d.total)+'</b></div><div class="expenseStat"><span>Categories</span><b>'+d.entries.length+'</b></div><div class="expenseStat"><span>Biggest</span><b>'+esc(top[0])+'</b></div></div><div class="expenseBreakdownRows">'+rows+'</div>';
  };
  var oldReports=window.renderReports;
  window.renderReports=function(){if(typeof oldReports==='function')oldReports();try{renderExpenseBreakdown()}catch(e){console.warn('Expense breakdown skipped',e)}};
  window.addEventListener('load',function(){setTimeout(function(){try{renderExpenseBreakdown()}catch(e){}},420)});
})();
(function mobileBackNavigation(){
  var internalNav=false;
  var initialized=false;
  var screenIds=['dashboard','bills','accounts','reports','settings','search'];
  function activeScreen(){
    var active=document.querySelector('.screen.active');
    return active&&active.id?active.id:(screen||'dashboard');
  }
  function navButtonFor(id){
    var map={dashboard:0,bills:1,accounts:3,reports:4};
    if(map[id]===undefined)return null;
    return document.querySelectorAll('.nav button')[map[id]]||null;
  }
  function hasOpenSheet(){
    return !!document.querySelector('.sheet.show');
  }
  function stateFor(id){
    return {pesoTrack:true,screen:screenIds.includes(id)?id:'dashboard'};
  }
  function urlFor(id){
    return '#'+(screenIds.includes(id)?id:'dashboard');
  }
  function pushScreen(id,replace){
    if(!window.history||!history.pushState)return;
    var next=screenIds.includes(id)?id:'dashboard';
    try{
      if(replace)history.replaceState(stateFor(next),'',urlFor(next));
      else history.pushState(stateFor(next),'',urlFor(next));
    }catch(e){}
  }
  var previousGo=window.go;
  window.go=function(id,btn,skipHistory){
    if(typeof previousGo==='function')previousGo(id,btn);
    if(!skipHistory&&!internalNav)pushScreen(id,false);
  };
  try{go=window.go}catch(e){}

  window.addEventListener('popstate',function(e){
    if(hasOpenSheet()){
      closeTopModal();
      pushScreen(activeScreen(),false);
      return;
    }
    var target=e.state&&e.state.pesoTrack?e.state.screen:'dashboard';
    if(!screenIds.includes(target))target='dashboard';
    if(target===activeScreen()){
      pushScreen(target,false);
      if(typeof toastMsg==='function')toastMsg('You are already on Home');
      return;
    }
    internalNav=true;
    try{window.go(target,navButtonFor(target),true)}finally{internalNav=false}
  });

  window.addEventListener('load',function(){
    if(initialized)return;
    initialized=true;
    var start=activeScreen();
    pushScreen(start,true);
    pushScreen(start,false);
  });
})();

(function homeUpcomingFocus(){
  function localDateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  function monthKeyForDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')}
  function recurringPaidForOccurrence(r,d){
    var key=monthKeyForDate(d);
    return (data.txns||[]).some(function(t){
      return t.recurringId===r.id&&(t.occurrenceMonth===key||String(t.occurrenceKey||'').slice(0,7)===key);
    });
  }
  function homeUpcomingItems(){
    var today=new Date();today.setHours(0,0,0,0);
    var max=new Date(today);max.setDate(max.getDate()+45);
    var items=[];
    (data.bills||[]).filter(function(b){return b.status!=='Paid'}).forEach(function(b){
      var d=new Date(b.dueDate);d.setHours(0,0,0,0);
      if(d<=max)items.push({date:d,title:b.cardName||'Card bill',sub:'Credit card due',amount:Number(b.remaining||b.amount||0),type:'Bill',kind:'bill'});
    });
    (data.recurring||[]).filter(function(r){return r.enabled!==false}).forEach(function(r){
      var d=nextRecurringDate(r);d.setHours(0,0,0,0);
      if(d<=max&&!recurringPaidForOccurrence(r,d)){
        items.push({date:d,title:r.name||r.category||r.type,sub:'Recurring '+(r.type||'item'),amount:Number(r.amount||0),type:r.type==='Income'?'Income':'Recurring',kind:r.type==='Income'?'income':'recurring'});
      }
    });
    return items.sort(function(a,b){return a.date-b.date}).slice(0,5);
  }
  function renderHomeUpcomingFocus(){
    var el=document.getElementById('upcoming');
    if(!el)return;
    var items=homeUpcomingItems();
    if(!items.length){
      el.innerHTML='<div class="softEmpty">No upcoming unpaid bills or recurring items.</div>';
      return;
    }
    el.innerHTML=items.map(function(item){
      var dd=daysUntil(localDateKey(item.date));
      var dueText=dd<0?'Overdue':dd===0?'Due today':dd===1?'Due tomorrow':'Due in '+dd+' days';
      var badgeClass=dd<0?'overdue':dd<=3?'dueSoon':item.kind==='income'?'income':'';
      var amt=(item.kind==='income'?'+':'')+peso(item.amount);
      var month=item.date.toLocaleDateString('en-PH',{month:'short'});var day=String(item.date.getDate());return '<div class="premiumTimelineItem"><div class="upcomingDateBadge"><b>'+htmlText(day)+'</b><span>'+htmlText(month)+'</span></div><div class="premiumTimelineMain"><b>'+htmlText(item.title)+'</b><span>'+htmlText(item.sub)+' - '+htmlText(dueText)+'</span></div><div class="premiumTimelineAmt"><b>'+amt+'</b><span class="upcomingKind '+badgeClass+'">'+htmlText(item.type)+'</span></div></div>';
    }).join('');
  }
  var previousRenderDash=window.renderDash||renderDash;
  window.renderDash=function(){
    if(typeof previousRenderDash==='function')previousRenderDash();
    renderHomeUpcomingFocus();
  };
  try{renderDash=window.renderDash}catch(e){}
  window.addEventListener('load',function(){setTimeout(function(){try{renderHomeUpcomingFocus()}catch(e){}},260)});
})();

(function finishBootWithoutOldHomeFlash(){
  try{if(typeof render==='function')render();}catch(e){console.warn('Final boot render skipped',e)}
  var release=function(){try{document.body.classList.remove('booting')}catch(e){}};
  if(window.requestAnimationFrame)requestAnimationFrame(release);else setTimeout(release,0);
  setTimeout(release,600);
})();
