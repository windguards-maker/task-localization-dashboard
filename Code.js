// ---------------------------------------------------------
// [환경 설정] 사진이 들어있는 구글 드라이브 폴더 ID
const PHOTO_FOLDER_ID = '1j2kZZhor6BB8WJtOR2R19RDp-jIGO2_1'; 
// ---------------------------------------------------------

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('업무 분장별 현지화율 및 교육과목 현황판')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 사진 폴더 내 파일 매핑 정보(사번 -> 파일ID)를 가져옵니다.
 * 성능 최적화를 위해 CacheService를 사용하여 30분간 유지합니다.
 */
function getPhotoMappingWithCache(forceRefresh = false) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'PHOTO_MAPPING_DATA_V4'; // 폴더 변경에 따른 캐시 강제 갱신
  
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  // 캐시가 없거나 강제 갱신인 경우 드라이브 폴더 스캔
  const photoMapping = {};
  try {
    const folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const rawFullName = file.getName();
      const dotIndex = rawFullName.lastIndexOf('.');
      
      if (dotIndex > 0) {
        // 확장자 제거 및 특수문자/공백 완전 박멸 (대문자 통일)
        const pureId = rawFullName.substring(0, dotIndex).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (pureId) {
          photoMapping[pureId] = file.getId();
        }
      }
    }
    // 약 30분(1800초) 동안 캐시 저장
    cache.put(cacheKey, JSON.stringify(photoMapping), 1800);
    console.log("📸 사진 폴더 캐시(V3) 갱신 완료 - 총 " + Object.keys(photoMapping).length + "개 매핑");
  } catch (e) {
    console.warn("⚠️ 사진 폴더를 읽어오는 중 오류 발생: " + e.message);
  }
  
  return photoMapping;
}

// 모든 시트의 데이터를 읽어와 JSON 객체로 반환하는 함수
function getDashboardData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 0. 사진 매핑 정보 가져오기 (캐시 활용)
  const photoMapping = getPhotoMappingWithCache();

  // 1. 상태 데이터 (Task_localiazation_status)
  const statusSheet = ss.getSheetByName('Task_localiazation_status');
  const statusData = statusSheet.getDataRange().getDisplayValues(); 
  const statusHeaders = statusData.shift();
  
  const statusList = statusData.map(row => {
    return {
      factory: row[0],
      dept: row[1],
      part: row[2],
      typeOffice: row[3], // O 이면 사무
      typeField: row[4],  // O 이면 현장
      taskName: row[5],
      taskDesc: row[6],
      goalRate: parseFloat(String(row[7]).replace('%','')) || 0,
      currentRate: parseFloat(String(row[8]).replace('%','')) || 0,
      employees: [
        {name: row[9], id: row[10]},
        {name: row[11], id: row[12]},
        {name: row[13], id: row[14]},
        {name: row[15], id: row[16]},
        {name: row[17], id: row[18]},
        {name: row[19], id: row[20]}
      ].filter(e => e.id) // 사번이 있는 사람만 추출
    };
  });

  // 2. 인원 데이터 (Manpower_master)
  const manpowerSheet = ss.getSheetByName('Manpower_master');
  const manpowerData = manpowerSheet.getDataRange().getValues();
  const manpowerHeaders = manpowerData.shift();
  
  const manpowerList = manpowerData.map(row => {
    // 엑셀 시트의 사번도 동일한 규칙으로 정제 (공백/특수문자 제거 후 대문자)
    const rawId = String(row[5] || '').trim();
    const cleanId = rawId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    // 드라이브 폴더 내 파일 ID가 있으면 직링크 생성
    let photoUrl = "";
    if (photoMapping[cleanId]) {
      photoUrl = 'https://drive.google.com/uc?export=view&id=' + photoMapping[cleanId];
    } else {
      photoUrl = row[8] ? String(row[8]).trim() : ''; // 기존 시트의 URL
    }

    return {
      factory: row[0],
      dept: row[1],
      part: row[2],
      type: row[3], // 사무직 / 현장직
      name: row[4],
      id: rawId,
      position: row[6],
      grade: row[7],
      photo: photoUrl
    };
  });

  // 3. 과목 데이터 (Task_subject)
  const subjectSheet = ss.getSheetByName('Task_subject');
  const subjectData = subjectSheet.getDataRange().getValues();
  const subjectHeaders = subjectData.shift();
  
  const subjectList = subjectData.map(row => {
    let related = [];
    for(let i=4; i<=12; i++) { if(row[i]) related.push(row[i]); } // 관련교과 1~9
    
    let additional = [];
    for(let i=13; i<=20; i++) { if(row[i]) additional.push(row[i]); } // 추가교과 1~8

    return {
      factory: row[0],
      dept: row[1],
      part: row[2],
      taskName: row[3],
      related: related,
      additional: additional
    };
  });

  // 4. 과목 마스터 데이터 (Subject_master) 
  const masterSheet = ss.getSheetByName('Subject_master');
  let masterList = [];
  if (masterSheet) {
    const masterData = masterSheet.getDataRange().getValues();
    masterData.shift(); // 첫 줄(헤더) 제거
    masterList = masterData.map(row => {
      return {
        category: row[0], // 정규과목 등
        code: row[1],     // 과목번호
        name: row[2],     // 과목명
        dept: row[3],     // 주관부서
        manager: row[4]   // 담당주재원
      };
    });
  }

  return {
    statusData: statusList,
    manpowerData: manpowerList,
    subjectData: subjectList,
    masterData: masterList 
  };
}



// --- 이미지 URL 변환 함수 (기존 코드와 동일하게 유지) ---
function updateImageUrls() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Manpower_master');
  
  if (!sheet) {
    SpreadsheetApp.getUi().alert("❌ 오류: 'Manpower_master' 시트를 찾을 수 없습니다.");
    return;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // 1. '사진' 열 찾기
  let photoColIdx = -1;
  for (let j = 0; j < headers.length; j++) {
    let h = String(headers[j]).trim();
    if (h.includes('사진') || h.toLowerCase().includes('photo')) {
      photoColIdx = j;
      break;
    }
  }
  
  if (photoColIdx === -1) {
    SpreadsheetApp.getUi().alert("❌ 오류: 첫 번째 줄(헤더)에서 '사진' 또는 'Photo' 열을 찾을 수 없습니다.");
    return;
  }

  let updateCount = 0;
  let notFoundCount = 0;
  let emptyCount = 0;
  let alreadyLinkCount = 0;

  // 2. 데이터 변환 시작
  for (let i = 1; i < data.length; i++) {
    let photoPath = String(data[i][photoColIdx]).trim(); 
    
    // 빈 칸인 경우 건너뛰기
    if (!photoPath || photoPath === 'undefined' || photoPath === '') {
      emptyCount++;
      continue;
    }
    
    // 이미 http 링크로 바뀐 경우 건너뛰기
    if (photoPath.startsWith('http')) {
      alreadyLinkCount++;
      continue;
    }

    // 2025_evaluation_Images 경로가 포함된 경우
    if (photoPath.includes('2025_evaluation_Images')) {
      let fileName = photoPath.split('/').pop(); // 예: pf20022105.Photo.100032.jpg
      let searchName = fileName.replace(/\.[^/.]+$/, ""); // 확장자 제거 (예: pf20022105.Photo.100032)
      
      // 구글 드라이브에서 파일 검색 (휴지통 제외)
      let files = DriveApp.searchFiles("title contains '" + searchName + "' and trashed = false");
      
      if (files.hasNext()) {
        let file = files.next();
        let directUrl = 'https://drive.google.com/uc?export=view&id=' + file.getId();
        
        // 시트에 직링크 덮어쓰기
        sheet.getRange(i + 1, photoColIdx + 1).setValue(directUrl);
        updateCount++;
      } else {
        notFoundCount++;
      }
    }
  }
  
  // 3. 작업이 끝나면 구글 시트 화면에 팝업 알림 띄우기
  let resultMsg = `[ 🖼️ 이미지 링크 변환 결과 ]\n\n` +
                  `✅ 성공적으로 변환됨 : ${updateCount}건\n` +
                  `❌ 드라이브에서 사진을 못 찾음 : ${notFoundCount}건\n` +
                  `🔗 이미 링크로 변환된 셀 : ${alreadyLinkCount}건\n` +
                  `➖ 사진이 없는 빈 칸 : ${emptyCount}건`;
                  
  SpreadsheetApp.getUi().alert(resultMsg);
}