/*
 * 하이웍스에서 읽어온 "이름 -> 날짜[]"를 연차/복지제도의 연차내역 레코드에 병합한다.
 * - 이름은 정확히 일치하는 경우만 매칭한다(동명이인 위험 회피 — 팀 정보까지 자동으로
 *   대조하기엔 하이웍스 쪽에 팀 정보가 없어서 이름만으로 판단).
 * - 이미 usageSlots에 있는 날짜는 건너뛰고(중복 방지), 빈 칸에만 채운다.
 * - 슬롯(LEAVE_SLOT_COUNT)이 부족해서 못 채운 날짜는 overflow로 따로 보고한다.
 * - 앱에는 있는데 하이웍스 쪽엔 없는 날짜는 지우지 않는다(동기화는 추가만 함 — 삭제는
 *   사람이 직접 하도록 남겨둔다). 대신 appOnlyDates로 보고해서 사용자가 확인할 수 있게 한다.
 *   단, 하이웍스 쪽 날짜는 애초에 주말이 항상 제외돼 있으므로(연차는 주말에 안 씀), 앱에
 *   남아있는 주말 날짜는 "차이"로 보고하지 않는다 — 항상 하이웍스엔 없을 수밖에 없어서
 *   보고해봐야 노이즈만 된다(과거 주말 제외 로직이 없던 시절 동기화로 잘못 들어간 값일 뿐).
 */

function isWeekend(monthDay, year) {
  const m = String(monthDay).trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return false;
  const dow = new Date(year, Number(m[1]) - 1, Number(m[2])).getDay();
  return dow === 0 || dow === 6;
}

function computeHiworksSync(leaveRecords, byNameDates, leaveSlotCount, year) {
  const updates = []; // { _id, name, addedDates, overflowDates }
  const unmatchedNames = []; // 하이웍스엔 있는데 앱 레코드에서 이름을 못 찾은 경우
  const appOnlyByName = []; // 앱엔 있는데 하이웍스 쪽엔 없는 날짜(참고용, 자동 삭제하지 않음)

  const recordsByName = new Map();
  leaveRecords.forEach((r) => {
    if (!recordsByName.has(r.name)) recordsByName.set(r.name, []);
    recordsByName.get(r.name).push(r);
  });

  byNameDates.forEach((hiworksDates, name) => {
    const matches = recordsByName.get(name);
    if (!matches || matches.length === 0) {
      unmatchedNames.push({ name, dates: hiworksDates });
      return;
    }
    // 동명이인이 있으면(드물겠지만) 첫 번째 레코드에 반영하고 나머지는 매칭 실패로 보고
    const rec = matches[0];
    const usageSlots = (rec.usageSlots || []).slice();
    while (usageSlots.length < leaveSlotCount) usageSlots.push("");
    const existing = new Set(usageSlots.filter((v) => v && String(v).trim() !== ""));

    const toAdd = hiworksDates.filter((d) => !existing.has(d));
    const added = [];
    const overflow = [];
    let slotIdx = 0;
    toAdd.forEach((date) => {
      while (slotIdx < leaveSlotCount && usageSlots[slotIdx]) slotIdx++;
      if (slotIdx >= leaveSlotCount) {
        overflow.push(date);
        return;
      }
      usageSlots[slotIdx] = date;
      slotIdx++;
      added.push(date);
    });

    if (added.length || overflow.length) {
      updates.push({ _id: rec._id, name, usageSlots, addedDates: added, overflowDates: overflow });
    }

    const appOnly = [...existing].filter((d) => !hiworksDates.includes(d) && !isWeekend(d, year));
    if (appOnly.length) appOnlyByName.push({ name, dates: appOnly });
  });

  return { updates, unmatchedNames, appOnlyByName };
}

module.exports = { computeHiworksSync };
