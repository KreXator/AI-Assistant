'use strict';
// Copy of LIVE_DATA_RE from nlRouter.js for isolated testing
const LIVE_DATA_RE = /\b(wiadomo[śs]ci|aktualno[śs]ci|przeg[lł][aą]d\s+wiadomo[śs]ci|skr[oó]t\s+wiadomo[śs]ci|(?:lokalne?|regionalne?)\s+wiadomo[śs]ci|wiadomo[śs]ci\s+(?:lokalne?|z\s+\w+)|headlines?|news\b|co\s+si[ęe]\s+dzieje|co\s+nowego(?:\s|$)|(?:najnowsze?|ostatnie?|aktualne?|bież[aą]ce?)\s+(?:wiadomo[śs]ci|info|doniesienia|wydarzen)|pogoda\b|prognoza\s+(?:pogody|na\s+\w+)|ile\s+stopni|kurs\s+\w+|notowania\b|gie[lł]da\b|bitcoin\b|btc\b|\beth\b|kryptowalu[tc]|cena\s+(?:benzyny|gazu|pr[aą]du|ropy|diesla)|wyniki?\s+(?:meczu?|ligi|rozgrywek)|tabela\s+\w*\s*ligi|kto\s+wygra[lł]|co\s+(?:graj[aą]|leci)(?:\s|$)|wydarzenia\s+w\b|imprezy?\s+w\b)/i;

const shouldMatch = [
  'podaj przegląd wiadomości',
  'Podaj skrót wiadomości lokalnych',
  'podaj wiadomosci lokalne',
  'jakie są aktualności',
  'co się dzieje w Polsce',
  'podaj mi news',
  'wiadomości z Zielonej Góry',
  'najnowsze wiadomości sportowe',
  'jaka pogoda jutro',
  'kurs bitcoin',
  'notowania giełdowe',
  'wyniki meczu Legia',
  'tabela ligi',
  'kto wygrał Eurowizję',
  'co grają w kinie',
  'cena benzyny dziś',
  'prognoza pogody na jutro',
];

const shouldNotMatch = [
  'przypomnij mi o 18:00',
  'napisz funkcję w Python',
  'jak działa RSS',
  'moje zadania',
  'zapamiętaj że lubię kawę',
  'zaplanuj wyjazd do Krakowa',
  'opowiedz mi bajkę',
];

let pass = true;
shouldMatch.forEach(t => {
  const r = LIVE_DATA_RE.test(t);
  if (!r) { console.log('MISS:', t); pass = false; }
});
shouldNotMatch.forEach(t => {
  const r = LIVE_DATA_RE.test(t);
  if (r) { console.log('FALSE POSITIVE:', t); pass = false; }
});
console.log(pass ? 'All pass.' : 'FAILURES above.');
