// ---------------------------------------------------------
// [환경 설정 1] 인원 사진 폴더 ID (읽기 전용, updateImageUrls 에서 사용)
const PHOTO_FOLDER_ID = '1j2kZZhor6BB8WJtOR2R19RDp-jIGO2_1';
// [환경 설정 2] 교육 증빙 사진 저장 폴더 ID
const TRAINING_PHOTO_FOLDER_ID = '1dlOSJSlBv5yOQz0NpoOivTMoCk35Q6k0';
// ---------------------------------------------------------


function doGet(e) {
  var page = (e && e.parameter && e.parameter.p) || 'index';
  var title = '업무 분장별 현지화율 및 교육과목 현황판';
  var fileName = 'Index';
  
  if (page.toLowerCase() === 'trainer') {
    title = '👨‍🏫 Local Trainer Management System';
    fileName = 'Trainer';
  }

  return HtmlService.createHtmlOutputFromFile(fileName)
      .setTitle(title)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 사진 폴더 내 파일 매핑 정보(사번 -> 파일ID)를 가져옵니다.
 * 성능 최적화를 위해 CacheService를 사용하여 30분간 유지합니다.
 */
function getPhotoMappingWithCache(forceRefresh) {
  forceRefresh = forceRefresh || false;
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

function getDashboardData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. 상태 데이터 (Task_localiazation_status)
  const statusSheet = ss.getSheetByName('Task_localiazation_status');
  const statusData = statusSheet.getDataRange().getValues(); 
  const statusHeaders = statusData.shift();
  
  const statusList = statusData.map(row => {
    let goal = row[7];
    if (typeof goal === 'number' && goal <= 1.0) goal = goal * 100;
    else goal = parseFloat(String(goal).replace('%','')) || 0;

    let current = row[8];
    if (typeof current === 'number' && current <= 1.0) current = current * 100;
    else current = parseFloat(String(current).replace('%','')) || 0;

    return {
      factory: row[0],
      dept: row[1],
      part: row[2],
      typeOffice: row[3],
      typeField: row[4],
      taskName: row[5],
      taskDesc: row[6],
      goalRate: Math.round(goal),
      currentRate: Math.round(current),
      employees: [
        {name: row[9], id: row[10]},
        {name: row[11], id: row[12]},
        {name: row[13], id: row[14]},
        {name: row[15], id: row[16]},
        {name: row[17], id: row[18]},
        {name: row[19], id: row[20]}
      ].filter(e => e.id)
    };
  });

  // 2. 인원 데이터 (Manpower_master) - 로딩 속도 최적화 (실시간 연산 제거)
  const manpowerSheet = ss.getSheetByName('Manpower_master');
  const manpowerData = manpowerSheet.getDataRange().getValues();
  manpowerData.shift();
  
  const manpowerList = manpowerData.map(row => {
    return {
      factory: row[0],
      dept: row[1],
      part: row[2],
      type: row[3],
      name: row[4],
      id: String(row[5] || '').trim(),
      photo: (row[8] && String(row[8]).startsWith('http')) ? String(row[8]).trim() : "" // 시트에 이미 적힌 주소만 읽음
    };
  });

  // 3. 과목 데이터 (Task_subject)
  const subjectSheet = ss.getSheetByName('Task_subject');
  const subjectData = subjectSheet.getDataRange().getValues();
  subjectData.shift();
  
  const subjectList = subjectData.map(row => {
    let related = [];
    for(let i=4; i<=12; i++) { if(row[i]) related.push(row[i]); }
    let additional = [];
    for(let i=13; i<=20; i++) { if(row[i]) additional.push(row[i]); }
    return {
      factory: row[0], dept: row[1], part: row[2], taskName: row[3],
      related: related, additional: additional
    };
  });

  // 4. 과목 마스터 데이터 (Subject_master) 
  const masterSheet = ss.getSheetByName('Subject_master');
  let masterList = [];
  if (masterSheet) {
    const masterData = masterSheet.getDataRange().getValues();
    masterData.shift();
    masterList = masterData.map(row => {
      return {
        category: row[0], code: row[1], name: row[2], engName: row[3],
        dept: row[4], manager: row[5], trainerName: row[6],
        trainerId: String(row[7] || '').trim()
      };
    });
  }

  // 5. 교육 결과 데이터 (Training_result)
  const trainingSheet = ss.getSheetByName('Training_result');
  let trainingList = [];
  if (trainingSheet) {
    const trainingData = trainingSheet.getDataRange().getValues();
    trainingData.shift();
    trainingList = trainingData.map(row => {
      return {
        timestamp: row[0] instanceof Date ? Utilities.formatDate(row[0], ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss") : String(row[0] || ''),
        date: row[1] instanceof Date ? Utilities.formatDate(row[1], ss.getSpreadsheetTimeZone(), "yyyy-MM-dd") : String(row[1] || ''),
        phase: String(row[2] || ''), subjectCode: row[3], subjectName: row[4],
        trainerId: String(row[5] || '').trim(),
        traineeId: String(row[6] || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
        score: row[7], opinion: row[8]
      };
    });
  }

  // 6. 교육 증빙 사진 데이터 (Training_evidence)
  // 구조: A=타임스탬프, B=차수, C=과목코드, D=강사사번, E=사진URL
  const evidenceSheet = ss.getSheetByName('Training_evidence');
  let evidenceList = [];
  if (evidenceSheet && evidenceSheet.getLastRow() > 1) {
    const evidenceData = evidenceSheet.getDataRange().getValues();
    evidenceData.shift();
    evidenceList = evidenceData.map(row => {
      return {
        timestamp: row[0] instanceof Date ? Utilities.formatDate(row[0], ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss") : String(row[0] || ''),
        phase: String(row[1] || ''),
        subjectCode: String(row[2] || ''),
        trainerId: String(row[3] || '').trim(),
        photoUrl: String(row[4] || '')
      };
    });
  }

  return {
    statusData: statusList,
    manpowerData: manpowerList,
    subjectData: subjectList,
    masterData: masterList,
    trainingData: trainingList,
    evidenceData: evidenceList
  };
}



// --- 이미지 URL 변환 함수 (기존 코드와 동일하게 유지) ---
/**
 * [중요] 드라이브 폴더를 한 번만 스캔하여 Manpower_master 시트의 I열(사진)에
 * 사번.jpg에 해당하는 직링크를 일괄적으로 기입합니다.
 * 3,800명 기준 약 10~20초 내외로 완료되며, 이후 대시보드 로딩 속도가 비약적으로 향상됩니다.
 */
function updateImageUrls() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Manpower_master');
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Manpower_master 시트를 찾을 수 없습니다.");
    return;
  }

  // 1. 드라이브 폴더 내 모든 파일을 한 번만 스캔하여 맵 제작 (사번 -> ID)
  const photoMap = {};
  try {
    const folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const n = file.getName();
      const idStr = n.split('.')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      if (idStr) photoMap[idStr] = file.getId();
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert("사진 폴더를 읽는 중 오류: " + e.message);
    return;
  }

  // 2. 시트 데이터 일괄 로드
  const range = sheet.getDataRange();
  const data = range.getValues();
  const headers = data[0];
  
  // '사진' 또는 'Photo'가 포함된 열 인덱스 찾기 (보통 I열 = 8번 인덱스)
  let photoColIdx = 8; 
  for (let j = 0; j < headers.length; j++) {
    if (String(headers[j]).includes('사진') || String(headers[j]).toLowerCase().includes('photo')) {
      photoColIdx = j; break;
    }
  }

  // 3. 사번(F열=5번 인덱스) 기준으로 사진 주소 매핑
  let updateCount = 0;
  for (let i = 1; i < data.length; i++) {
    const empId = String(data[i][5] || '').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    // 무조건 새로운 고해상도/고호환성 주소 형식으로 갱신
    if (photoMap[empId]) {
      const driveUrl = 'https://lh3.googleusercontent.com/d/' + photoMap[empId];
      data[i][photoColIdx] = driveUrl; // 메모리 상에서 데이터 업데이트
      updateCount++;
    }
  }

  // 4. 변경된 데이터를 시트에 일괄 쓰기 (매우 빠름)
  if (updateCount > 0) {
    range.setValues(data);
    SpreadsheetApp.getUi().alert("✅ 업데이트 완료: " + updateCount + "명의 사진 주소가 엑셀에 기록되었습니다.\n이제 대시보드 로딩 속도가 비약적으로 빨라집니다.");
  } else {
    SpreadsheetApp.getUi().alert("업데이트할 사진이 없거나 모두 이미 등록되어 있습니다.");
  }
}

/**
 * 트레이닝 모달에서 전달받은 제출 데이터를 Training_result 시트에 마지막 행으로 추가합니다.
 */
function saveTrainingRecords(submitData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Training_result');
  if (!sheet) throw new Error("'Training_result' sheet not found.");
  
  const now = new Date();
  const timestamp = Utilities.formatDate(now, ss.getSpreadsheetTimeZone() || "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  const trainees = submitData.trainees || [];
  if (trainees.length === 0) return true;

  // 1. 사진 업로드 후 Training_evidence 시트에 기록
  if (submitData.file && submitData.file.data) {
    const photoUrl = uploadPhotoToDrive(submitData.file, submitData.code + "_" + submitData.phase + "_" + submitData.date);
    if (photoUrl) {
      const evSheet = ss.getSheetByName('Training_evidence');
      if (!evSheet) throw new Error("'Training_evidence' sheet not found.");
      const evData = evSheet.getDataRange().getValues();
      // 같은 차수+과목+강사 조합이 있으면 URL 업데이트, 없으면 새 행 추가
      let evFound = false;
      for (let i = 1; i < evData.length; i++) {
        if (String(evData[i][1]) === String(submitData.phase) &&
            String(evData[i][2]).toUpperCase() === String(submitData.code).toUpperCase() &&
            String(evData[i][3]).toUpperCase() === String(submitData.trainerId).toUpperCase()) {
          evSheet.getRange(i + 1, 1).setValue(timestamp); // A: 타임스탬프 갱신
          evSheet.getRange(i + 1, 5).setValue(photoUrl);  // E: URL 갱신
          evFound = true;
          break;
        }
      }
      if (!evFound) {
        evSheet.appendRow([timestamp, submitData.phase, submitData.code, submitData.trainerId, photoUrl]);
      }
    }
  }

  // 2. Training_result 시트에 점수/의견 기록 (사진 URL 제외)
  const data = sheet.getDataRange().getValues();
  const rowsToAppend = [];

  trainees.forEach(t => {
    let foundIdx = -1;
    for (let i = 1; i < data.length; i++) {
       const row = data[i];
       const match = (String(row[2]) === String(submitData.phase)) &&
                     (String(row[3]).toUpperCase() === String(submitData.code).toUpperCase()) &&
                     (String(row[5]).toUpperCase() === String(submitData.trainerId).toUpperCase()) &&
                     (String(row[6]).toUpperCase() === String(t.traineeId).toUpperCase());
       if (match) { foundIdx = i + 1; break; }
    }

    const rowData = [
      timestamp,
      submitData.date,
      submitData.phase,
      submitData.code,
      submitData.name,
      submitData.trainerId,
      t.traineeId,
      t.score,
      t.opinion
    ];

    if (foundIdx > -1) {
      sheet.getRange(foundIdx, 1, 1, rowData.length).setValues([rowData]);
    } else {
      rowsToAppend.push(rowData);
    }
  });

  if (rowsToAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  }
  
  return true;
}

/**
 * 교육 증빙사진을 저장할 폴더를 가져옵니다.
 * TRAINING_PHOTO_FOLDER_ID가 설정되어 있으면 해당 폴더를,
 * 없으면 드라이브 루트에 'Training_Evidence_Photos' 폴더를 자동 생성합니다.
 */
function getTrainingPhotoFolder() {
  if (TRAINING_PHOTO_FOLDER_ID) {
    return DriveApp.getFolderById(TRAINING_PHOTO_FOLDER_ID);
  }
  // 루트에서 폴더 이름으로 찾거나 없으면 생성
  const folderName = 'Training_Evidence_Photos';
  const root = DriveApp.getRootFolder();
  const existing = root.getFoldersByName(folderName);
  if (existing.hasNext()) return existing.next();
  const newFolder = root.createFolder(folderName);
  newFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  console.log('📁 폴더 생성: ' + folderName + ' (ID: ' + newFolder.getId() + ')');
  return newFolder;
}

/**
 * 전송된 파일 객체를 구글 드라이브 교육증빙 폴더에 저장하고 웹에서 조회 가능한 URL을 반환합니다.
 * 실패 시 에러를 throw하여 호출자에게 알립니다.
 */
function uploadPhotoToDrive(fileObj, prefix) {
  const folder = getTrainingPhotoFolder();
  const fileName = prefix + '_' + fileObj.name;
  const contentType = fileObj.data.substring(5, fileObj.data.indexOf(';'));
  const bytes = Utilities.base64Decode(fileObj.data.split(',')[1]);
  const blob = Utilities.newBlob(bytes, contentType, fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = 'https://lh3.googleusercontent.com/d/' + file.getId();
  console.log('✅ 교육 사진 업로드 완료: ' + url);
  return url;
}

/**
 * [진단용] 교육 증빙사진 폴더 접근 테스트
 * 스크립트 에디터에서 실행 후 [실행 로그]에서 결과 확인
 */
function testPhotoFolderAccess() {
  try {
    const folder = getTrainingPhotoFolder();
    Logger.log('✅ 폴더 접근 성공! 폴더명: ' + folder.getName() + ' / ID: ' + folder.getId());
  } catch (e) {
    Logger.log('❌ 폴더 접근 실패: ' + e.message);
  }
}