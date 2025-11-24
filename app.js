const app = {
  settings: null,
  sessionId: null,
  data: {
    subjects: [],
    state: {
      currentSub: null,
      lastType: null,
      totalQ: 0,
      questions: [],
      questionIds: [],
      key: {},
      answers: {},
      bookmarks: new Set(),
      timeLeft: 0,
      timer: null,
      isReview: false,
      isSubmitted: false
    }
  },

  async init() {
    try {
      const res = await fetch('settings_mon.json', { cache: 'no-store' })
      this.settings = res.ok ? await res.json() : {}
    } catch (e) {
      this.settings = {}
    }

    this.sessionId = this.getOrCreateSessionId()

    const subs = Array.isArray(this.settings.subjects) ? this.settings.subjects : []
    this.data.subjects = subs.map(s => ({
      id: String(s.id || s.name || '').trim(),
      name: s.name || '',
      icon: s.icon || 'fa-book',
      color: s.color || 'bg-blue-500',
      locked: s.locked ?? this.settings.lockedByDefaultSubject ?? false,
      unlock: s.unlock ?? '',
      lockNote: s.lockNote ?? s.note ?? '',
      note: s.note ?? '',
      file: s.file ?? '',
      exams: s.exams || {}
    })).filter(s => s.id)


    this.checkNotice()
    this.renderSubjects()
    this.switchView('home')
  },

  getOrCreateSessionId() {
    let sid = localStorage.getItem('session_id')
    if (!sid) {
      if (crypto && crypto.randomUUID) sid = crypto.randomUUID()
      else sid = Date.now().toString(36) + Math.random().toString(36).slice(2)
      localStorage.setItem('session_id', sid)
    }
    return sid
  },

  hashSeed(str) {
    let h = 2166136261 >>> 0
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  },

  rngMulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5
      t = Math.imul(t ^ t >>> 15, t | 1)
      t ^= t + Math.imul(t ^ t >>> 7, t | 61)
      return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
  },

  seededShuffle(arr, seed) {
    const a = arr.slice()
    const rand = this.rngMulberry32(seed >>> 0)
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const tmp = a[i]
      a[i] = a[j]
      a[j] = tmp
    }
    return a
  },

  toggleTheme() {
    // 1. Đảo trạng thái class 'dark' trên thẻ HTML
    const html = document.documentElement
    const isDark = html.classList.toggle('dark')

    // 2. Lưu vào localStorage
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  },
  // ----------------------------------

  isSubjectUnlocked(id) {
    return localStorage.getItem(`unlocked_subject_${id}`) === '1'
  },

  isExamUnlocked(subId, type) {
    return localStorage.getItem(`unlocked_exam_${subId}_${type}`) === '1'
  },

  async tryUnlockSubject(sub) {
    if (!sub.locked) return true
    if (this.isSubjectUnlocked(sub.id)) {
      sub.locked = false
      return true
    }
    const note = sub.lockNote || sub.note || `Môn ${sub.name} đang khóa. Nhập mã để mở:`
    const code = prompt(note) || ''
    if (String(sub.unlock ?? '').trim() && code.trim() === String(sub.unlock).trim()) {
      localStorage.setItem(`unlocked_subject_${sub.id}`, '1')
      sub.locked = false
      alert('Đã mở khóa môn!')
      this.renderSubjects()
      return true
    }
    alert('Sai mã / chưa mở được môn.')
    return false
  },

  async tryUnlockExam(sub, type, lockInfo) {
    if (!lockInfo?.locked) return true
    if (this.isExamUnlocked(sub.id, type)) return true
    const note = lockInfo.note || `Bài ${lockInfo.name || type.toUpperCase()} của môn ${sub.name} đang khóa. Nhập mã mở:`
    const code = prompt(note) || ''
    if (String(lockInfo.unlock ?? '').trim() && code.trim() === String(lockInfo.unlock).trim()) {
      localStorage.setItem(`unlocked_exam_${sub.id}_${type}`, '1')
      alert('Đã mở khóa bài kiểm tra!')
      return true
    }
    alert('Sai mã / chưa mở được bài này.')
    return false
  },

  getExamLockInfo(sub, type) {
    const d = this.settings.examDefaults?.[type] || {}
    const s = sub.exams?.[type] || {}
    return { ...d, ...s }
  },

  getExamConfig(sub, type) {
    const configMap = {
      '15m': { t: 15, q: null, name: '15 Phút', level: 'Mức độ Dễ' }, 
      '45m': { t: 45, q: null, name: '1 Tiết', level: 'Mức độ Vừa' },
      'gk1': { t: 45, q: null, name: 'Giữa Học Kỳ 1', level: 'Mức độ Vừa' },
      'ck1': { t: 60, q: null, name: 'Cuối Học Kỳ 1', level: 'Mức độ Vừa' },
      'gk2': { t: 45, q: null, name: 'Giữa Học Kỳ 2', level: 'Mức độ Vừa' },
      'ck2': { t: 60, q: null, name: 'Cuối Học Kỳ 2', level: 'Mức độ Vừa' },
      'hk':  { t: 90, q: null, name: 'Thi THPT QG', level: 'Mức độ Khó' }
    }
    const base = configMap[type] || {}
    const examSpec = sub.exams?.[type] || {}
    const lockInfo = this.getExamLockInfo(sub, type)
    const merged = { ...base, ...examSpec }
    
    return {
      t: merged.t ?? base.t,
      q: merged.q ?? base.q,
      name: merged.name ?? base.name,
      level: merged.level ?? base.level,
      title: merged.title,
      file: merged.file || sub.file,
      lockInfo
    }
  },


  checkNotice() {
    const modal = document.getElementById('ai-notice-modal')
    if (!modal) return

    const lastSeen = localStorage.getItem('notice_timestamp')
    const now = Date.now()
    const duration = 2 * 60 * 60 * 1000 

    if (!lastSeen || (now - lastSeen > duration)) {
      modal.classList.remove('hidden')
    }
  },

  closeNotice() {
    const modal = document.getElementById('ai-notice-modal')
    if (!modal) return

    localStorage.setItem('notice_timestamp', Date.now())
    
    modal.classList.add('hidden')
  },

  renderSubjects() {
    const grid = document.getElementById('subject-grid')
    grid.innerHTML = this.data.subjects.map(s => {
      const locked = (s.locked ?? this.settings.lockedByDefaultSubject) && !this.isSubjectUnlocked(s.id)
      return `
        <div onclick="app.selectSubject('${s.id}')" class="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 hover:border-primary-500 hover:shadow-md cursor-pointer transition-all h-36 flex flex-col items-center justify-center gap-2 active:scale-95 group ${locked ? 'opacity-60' : ''}">
          <div class="w-14 h-14 ${s.color} rounded-full flex items-center justify-center text-white shadow-md group-hover:scale-110 transition-transform relative">
            <i class="fa-solid ${s.icon} text-xl"></i>
          </div>
          <div class="text-center">
            <div class="font-bold">${s.name}</div>
            ${locked ? `<div class="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Đang khóa</div>` : ``}
          </div>
        </div>
      `
    }).join('')
  },

  async selectSubject(id) {
    const sub = this.data.subjects.find(s => s.id === id)
    if (!sub) return
    if ((sub.locked ?? this.settings.lockedByDefaultSubject) && !(await this.tryUnlockSubject(sub))) return

    this.data.state.currentSub = sub

    document.getElementById('selected-sub-name').innerText = sub.name
    document.getElementById('selected-sub-icon').className = `w-16 h-16 rounded-2xl ${sub.color} flex items-center justify-center text-white shadow-md text-3xl`
    document.getElementById('selected-sub-icon').innerHTML = `<i class="fa-solid ${sub.icon}"></i>`

    this.switchView('select')
    await this.renderExamTiles()
  },

  async renderExamTiles() {
    const sub = this.data.state.currentSub
    if (!sub) return
    const tiles = Array.from(document.querySelectorAll('.exam-tile[data-exam-type]'))
    
    // Map số lượng câu mặc định để hiển thị nếu không load được file
    const defaultCounts = { '15m': 10, '45m': 30, 'gk1': 40, 'ck1': 50, 'gk2': 40, 'ck2': 50, 'hk': 50 }

    await Promise.all(tiles.map(async tile => {
      const type = tile.dataset.examType
      const cfg = this.getExamConfig(sub, type)
      const lockInfo = cfg.lockInfo || {}
      const locked = (lockInfo.locked ?? this.settings.lockedByDefaultExam ?? false) && !this.isExamUnlocked(sub.id, type)

      // Xử lý UI khóa/mở
      tile.classList.toggle('opacity-75', locked)
      const badge = tile.querySelector('.exam-locked-badge')
      if (badge) badge.classList.toggle('hidden', !locked)

      // Cập nhật tiêu đề
      const h3 = tile.querySelector('h3')
      if (cfg.title && h3) h3.textContent = cfg.title

      // --- SỬA LOGIC ĐẾM CÂU HỎI (Fix lỗi 0 câu) ---
      let qCount = cfg.q
      // Nếu cấu hình là null (để lấy hết), ta thử load file để đếm
      if (qCount == null) {
        const bank = await this.loadQuestionBank(cfg.file)
        if (bank && bank.length > 0) {
          qCount = bank.length
        } else {
          // Nếu load lỗi hoặc = 0, lấy số mặc định để hiển thị cho đẹp
          qCount = defaultCounts[type] || 0
        }
      }

      // Cập nhật dòng Meta
      const meta = tile.querySelector('[data-exam-meta]')
      if (meta) {
        const levelTxt = cfg.level ? ` • ${cfg.level}` : ''
        meta.textContent = `${qCount} câu • ${cfg.t} phút${levelTxt}`
      }
    }))
  },

  goHome() {
    this.switchView('home')
  },

  onExamTileClick(type) {
    const sub = this.data.state.currentSub
    if (!sub) return
    const cfg = this.getExamConfig(sub, type)
    const lockInfo = cfg.lockInfo || {}
    const locked = (lockInfo.locked ?? this.settings.lockedByDefaultExam ?? false) && !this.isExamUnlocked(sub.id, type)
    if (locked) {
      this.tryUnlockExam(sub, type, { ...lockInfo, name: cfg.name }).then(ok => {
        if (ok) this.startExam(type)
      })
      return
    }
    this.startExam(type)
  },

  idxToLetter(i) {
    return String.fromCharCode(65 + i)
  },

  getOptions(q) {
    const a = q.answeroption || q.answerOptions || q.options || q.answers || []
    return Array.isArray(a) ? a : []
  },

  getCorrectIndex(opts) {
    const idx = opts.findIndex(o => o && o.isCorrect === true)
    return idx >= 0 ? idx : 0
  },

  async loadQuestionBank(file) {
    if (!file) return null
    try {
      const res = await fetch(file, { cache: 'no-store' })
      if (!res.ok) return null
      const raw = await res.json()
      const arr = raw.question || raw.questions || raw.data || raw
      if (!Array.isArray(arr)) return null
      return arr
    } catch (e) {
      return null
    }
  },

  sessionKey(subId, type) {
    return `exam_session_${this.sessionId}_${subId}_${type}`
  },

  loadExamSession(key) {
    try {
      const v = localStorage.getItem(key)
      if (!v) return null
      return JSON.parse(v)
    } catch {
      return null
    }
  },

  saveExamSession() {
    const st = this.data.state
    const sub = st.currentSub
    if (!sub || !st.lastType) return
    const key = this.sessionKey(sub.id, st.lastType)
    const payload = {
      subId: sub.id,
      type: st.lastType,
      file: st.file,
      questionIds: st.questionIds,
      answers: st.answers,
      bookmarks: Array.from(st.bookmarks),
      timeLeft: st.timeLeft,
      isSubmitted: st.isSubmitted,
      startedAt: st.startedAt
    }
    localStorage.setItem(key, JSON.stringify(payload))
  },

  clearExamSession(subId, type) {
    const key = this.sessionKey(subId, type)
    localStorage.removeItem(key)
  },

  async startExam(type, forceNew=false) {
    const sub = this.data.state.currentSub
    if (!sub) return
    const cfg = this.getExamConfig(sub, type)
    if (!cfg.file) {
      alert('Chưa có file câu hỏi')
      return
    }

    const bank = await this.loadQuestionBank(cfg.file)
    if (!bank || bank.length === 0) {
      alert('Không load được câu hỏi')
      return
    }

    const key = this.sessionKey(sub.id, type)
    // Nếu forceNew (Làm lại) -> Bỏ qua session cũ
    const saved = forceNew ? null : this.loadExamSession(key)

    let questions = []
    let questionIds = []
    let timeLeft = cfg.t * 60
    let answers = {}
    let bookmarks = new Set()
    let startedAt = Date.now()

    if (saved && !saved.isSubmitted && saved.file === cfg.file && Array.isArray(saved.questionIds) && saved.questionIds.length > 0) {
      // --- TRƯỜNG HỢP TIẾP TỤC BÀI CŨ ---
      questionIds = saved.questionIds.filter(i => i >= 0 && i < bank.length)
      questions = questionIds.map(i => bank[i]).filter(Boolean)
      timeLeft = typeof saved.timeLeft === 'number' ? saved.timeLeft : timeLeft
      answers = saved.answers || {}
      bookmarks = new Set(saved.bookmarks || [])
      startedAt = saved.startedAt || startedAt
    } else {
      // --- TRƯỜNG HỢP TẠO ĐỀ MỚI (LÀM LẠI HOẶC MỚI TINH) ---
      const indices = Array.from({ length: bank.length }, (_, i) => i)
      
      // FIX LOGIC RANDOM:
      // Nếu là làm lại (forceNew) hoặc bài mới, ta cộng thêm Date.now() vào seed để đảm bảo luôn ngẫu nhiên
      // Không dùng cố định sessionId nữa
      const seedString = `${this.sessionId}|${sub.id}|${type}|${cfg.file}|${Date.now()}`
      const seed = this.hashSeed(seedString)
      
      const shuffledIdx = this.seededShuffle(indices, seed)
      
      // FIX LOGIC SỐ LƯỢNG CÂU:
      // Nếu cfg.q là null (do mình set ở trên) -> Lấy bank.length (tất cả câu)
      // Nếu cfg.q có số (ví dụ 40) -> Lấy min(40, tổng số câu)
      const limit = cfg.q ? cfg.q : bank.length
      const takeN = Math.min(limit, shuffledIdx.length)
      
      questionIds = shuffledIdx.slice(0, takeN)
      questions = questionIds.map(i => bank[i])
    }

    const keyMap = {}
    questions.forEach((q, idx) => {
      const opts = this.getOptions(q)
      keyMap[idx + 1] = this.getCorrectIndex(opts)
    })

    clearInterval(this.data.state.timer)

    this.data.state = {
      currentSub: sub,
      lastType: type,
      totalQ: questions.length,
      questions,
      questionIds,
      key: keyMap,
      answers,
      bookmarks,
      timeLeft,
      timer: null,
      isReview: false,
      isSubmitted: false,
      file: cfg.file,
      startedAt
    }

    this.saveExamSession()

    document.getElementById('quiz-title-display').innerText = sub.name
    // Cập nhật text hiển thị số câu
    document.getElementById('quiz-status-text').innerText = `${cfg.name} • ${questions.length} câu`

    document.getElementById('timer-container').classList.remove('hidden')
    document.getElementById('mobile-action-bar').classList.remove('hidden')
    document.getElementById('desktop-action-area').classList.remove('hidden')

    this.switchView('quiz')
    this.renderQuestions()
    this.renderPalette()
    this.updateTimerDisplay()
    this.startTimer()
  },

  startTimer() {
    const st = this.data.state
    clearInterval(st.timer)
    st.timer = setInterval(() => {
      if (st.isReview || st.isSubmitted) return
      st.timeLeft--
      if (st.timeLeft <= 0) {
        this.submitExam(true)
        return
      }
      this.updateTimerDisplay()
      this.saveExamSession()
    }, 1000)
  },

  updateTimerDisplay() {
    const st = this.data.state
    const m = Math.floor(st.timeLeft / 60)
    const s = st.timeLeft % 60
    document.getElementById('timer').innerText = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  },

  renderQuestions() {
    const st = this.data.state
    const wrap = document.getElementById('questions-container')
    
    wrap.innerHTML = st.questions.map((q, i) => {
      const qi = i + 1
      const opts = this.getOptions(q)
      const userAns = st.answers[qi]
      const correctIdx = st.key[qi]
      const isBookmarked = st.bookmarks.has(qi)
      
      // --- XỬ LÝ PHẦN GIẢI THÍCH (Chỉ hiện khi xem lại hoặc có nút xem) ---
      const explain = q.explain || q.explanation || ''
      const explainBox = explain ? `
        <div id="explain-box-${qi}" class="mt-4 ${st.isReview ? '' : 'hidden'}">
          <button onclick="app.toggleExplanation(${qi})" class="w-full flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 px-4 py-3 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            <span><i class="fa-solid fa-lightbulb text-yellow-500 mr-2"></i>Giải thích chi tiết</span>
            <i id="explain-icon-${qi}" class="fa-solid fa-chevron-down rotate-icon transition-transform duration-300"></i>
          </button>
          <div id="explain-content-${qi}" class="explanation-content mt-3 text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 leading-relaxed ${st.isReview ? 'open' : ''}">
            ${explain}
          </div>
        </div>
      ` : ''

      // --- XỬ LÝ DANH SÁCH ĐÁP ÁN (PHẦN QUAN TRỌNG NHẤT) ---
      const optionsHtml = opts.map((o, oi) => {
        // Kiểm tra xem user đã chọn câu này chưa
        const isChecked = userAns == oi ? 'checked' : ''
        
        // Biến style cho chế độ Xem lại (Review)
        let reviewClass = ""
        let reviewIcon = "" // Icon mặc định rỗng (sẽ hiện khi check hoặc review)

        if (st.isReview) {
           // Logic màu sắc khi xem lại
           if (oi === correctIdx) {
             // ĐÁP ÁN ĐÚNG -> Màu xanh lá
             reviewClass = "!border-green-500 !bg-green-50 dark:!bg-green-900/20"
             reviewIcon = `<div class="ml-auto text-green-600 dark:text-green-400 font-bold text-xs uppercase tracking-wider bg-green-100 dark:bg-green-900/40 px-2 py-1 rounded">Đúng</div>`
           } else if (userAns == oi && oi !== correctIdx) {
             // CHỌN SAI -> Màu đỏ
             reviewClass = "!border-red-500 !bg-red-50 dark:!bg-red-900/20"
             reviewIcon = `<div class="ml-auto text-red-600 dark:text-red-400 font-bold text-xs uppercase tracking-wider bg-red-100 dark:bg-red-900/40 px-2 py-1 rounded">Sai</div>`
           } else {
             // KHÔNG LIÊN QUAN -> Mờ đi
             reviewClass = "opacity-50 grayscale"
           }
        }

        return `
          <label id="opt-${qi}-${oi}" class="relative w-full block mb-3 cursor-pointer group select-none">
            
            <input type="radio" name="q${qi}" value="${oi}" 
                   class="peer sr-only" 
                   onchange="app.onAnswer(${qi}, ${oi})" 
                   ${isChecked} 
                   ${st.isReview ? 'disabled' : ''}>

            <div class="flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 
                        hover:border-blue-400 dark:hover:border-blue-500/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-all duration-200
                        peer-checked:border-blue-500 peer-checked:bg-blue-50 dark:peer-checked:bg-blue-900/20 dark:peer-checked:border-blue-500
                        ${reviewClass}">
              
              <div class="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 border border-slate-200 dark:border-slate-600
                          bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 
                          group-hover:bg-white dark:group-hover:bg-slate-600 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:shadow-sm transition-all
                          peer-checked:bg-blue-600 peer-checked:text-white peer-checked:border-blue-600 peer-checked:shadow-md">
                ${this.idxToLetter(oi)}
              </div>
              
              <div class="flex-1 text-base text-slate-700 dark:text-slate-300 font-medium leading-snug 
                          peer-checked:text-blue-800 dark:peer-checked:text-blue-200">
                ${o.text || o.label || ''}
              </div>

              <div class="hidden peer-checked:block text-blue-600 dark:text-blue-400 animate-fade-in pl-2">
                <i class="fa-solid fa-circle-check text-xl shadow-sm rounded-full"></i>
              </div>

              ${reviewIcon ? `<div class="pl-2">${reviewIcon}</div>` : ''}

            </div>
          </label>
        `
      }).join('')

      // --- TRẢ VỀ HTML CỦA TOÀN BỘ CÂU HỎI ---
      return `
        <div id="q-${qi}" class="bg-white dark:bg-[#1e293b] p-5 md:p-6 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm mb-6 transition-all hover:shadow-md">
          
          <div class="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100 dark:border-slate-700/50">
            <span class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest bg-slate-100 dark:bg-slate-700/50 px-2 py-1 rounded">
              Câu ${qi}
            </span>
            <button onclick="app.toggleBookmark(${qi})" class="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 group">
              <i id="bookmark-${qi}" class="fa-solid fa-bookmark text-lg transition-colors ${isBookmarked ? 'text-yellow-500' : 'text-slate-300 dark:text-slate-600 group-hover:text-yellow-400'}"></i>
            </button>
          </div>

          <div class="text-lg font-semibold text-slate-800 dark:text-slate-100 leading-relaxed mb-6">
            ${q.text || q.question || ''}
          </div>

          <div class="space-y-1">
            ${optionsHtml}
          </div>
          
          ${explainBox}
        </div>
      `
    }).join('')

    this.updateProgress()
  },

  renderPalette() {
    const st = this.data.state
    const buildButtons = (containerId) => {
      const cont = document.getElementById(containerId)
      cont.innerHTML = Array.from({ length: st.totalQ }, (_, i) => {
        const qi = i + 1
        const userAns = st.answers[qi]
        const correctIdx = st.key[qi]
        
        // Style mặc định (chưa làm)
        let cls = 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-transparent hover:border-slate-300 dark:hover:border-slate-500'
        
        // Style khi ĐÃ CHỌN (Thêm border nổi bật như bạn yêu cầu)
        if (userAns != undefined) {
          cls = 'bg-blue-600 text-white shadow-md shadow-blue-500/30 border-2 border-blue-400 ring-1 ring-blue-600/50' 
        }

        // Style khi XEM LẠI (Review)
        if (st.isReview) {
          if (userAns == undefined) cls = 'bg-slate-200 dark:bg-slate-800 text-slate-400 opacity-50'
          else if (Number(userAns) === correctIdx) cls = 'bg-emerald-500 text-white shadow-sm border border-emerald-400'
          else cls = 'bg-red-500 text-white shadow-sm border border-red-400'
        }
        
        return `<button onclick="app.jumpToQuestion(${qi})" class="w-10 h-10 rounded-xl font-bold text-sm transition-all active:scale-95 flex items-center justify-center ${cls}">${qi}</button>`
      }).join('')
    }
    buildButtons('desktop-palette')
    buildButtons('mobile-palette')
    this.updateProgress()
  },

  updateProgress() {
    const st = this.data.state
    const done = Object.keys(st.answers || {}).length
    const total = st.totalQ
    const el = document.getElementById('progress-text')
    if (el) el.innerText = `${done}/${total}`
  },

  onAnswer(qi, oi) {
    const st = this.data.state
    if (st.isReview || st.isSubmitted) return
    st.answers[qi] = oi
    this.saveExamSession()
    this.renderPalette()
  },

  toggleBookmark(qi) {
    const st = this.data.state
    if (st.bookmarks.has(qi)) st.bookmarks.delete(qi)
    else st.bookmarks.add(qi)
    const icon = document.getElementById(`bookmark-${qi}`)
    if (icon) icon.classList.toggle('text-amber-500', st.bookmarks.has(qi))
    this.saveExamSession()
    this.renderPalette()
  },

  toggleExplanation(qi) {
    const content = document.getElementById(`explain-content-${qi}`)
    const icon = document.getElementById(`explain-icon-${qi}`)
    if (!content || !icon) return
    content.classList.toggle('open')
    icon.classList.toggle('open')
  },

  jumpToQuestion(qi) {
    const el = document.getElementById(`q-${qi}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (document.getElementById('mobile-drawer') && !document.getElementById('mobile-drawer').classList.contains('hidden')) {
      this.toggleDrawer()
    }
  },

  jumpToUnanswered() {
    const st = this.data.state
    for (let i = 1; i <= st.totalQ; i++) {
      if (st.answers[i] == undefined) {
        this.jumpToQuestion(i)
        return
      }
    }
    this.jumpToQuestion(1)
  },

  toggleDrawer() {
    const drawer = document.getElementById('mobile-drawer')
    const content = document.getElementById('drawer-content')
    if (!drawer || !content) return
    const isHidden = drawer.classList.contains('hidden')
    if (isHidden) {
      drawer.classList.remove('hidden')
      requestAnimationFrame(() => content.classList.remove('translate-y-full'))
    } else {
      content.classList.add('translate-y-full')
      setTimeout(() => drawer.classList.add('hidden'), 250)
    }
  },

  submitExam(auto=false) {
    const st = this.data.state
    if (st.isReview || st.isSubmitted) return
    if (!auto && !confirm('Nộp bài?')) return

    clearInterval(st.timer)

    let correct = 0, wrong = 0, skipped = 0
    for (let i = 1; i <= st.totalQ; i++) {
      const userAns = st.answers[i]
      const realAns = st.key[i]
      if (userAns == undefined) skipped++
      else if (Number(userAns) === realAns) correct++
      else wrong++
    }

    document.getElementById('final-score').innerText = ((correct / st.totalQ) * 10).toFixed(1)
    document.getElementById('final-correct').innerText = correct
    document.getElementById('final-wrong').innerText = wrong
    document.getElementById('final-skipped').innerText = skipped

    st.isSubmitted = true
    this.saveExamSession()

    this.switchView('result')
  },

  reviewExam() {
    const st = this.data.state
    st.isReview = true
    clearInterval(st.timer)
    document.getElementById('quiz-status-text').innerText = "Đang xem lại bài"
    document.getElementById('timer-container').classList.add('hidden')
    document.getElementById('mobile-action-bar').classList.add('hidden')
    document.getElementById('desktop-action-area').classList.add('hidden')
    this.switchView('quiz')
    this.renderQuestions()
    this.renderPalette()
  },

  quitQuiz() {
    const st = this.data.state
    if (st.isReview) {
      this.goHome()
      return
    }
    if (confirm('Dừng làm bài? Bài sẽ được lưu để làm tiếp.')) {
      this.goHome()
    }
  },

  switchView(view) {
    ['home', 'select', 'quiz', 'result'].forEach(v => {
      const el = document.getElementById(`view-${v}`)
      if (!el) return
      if (v === view) {
        el.classList.remove('hidden')
        if (v === 'quiz') el.classList.add('flex')
      } else {
        el.classList.add('hidden')
      }
    })
    window.scrollTo({ top: 0 })
  }
}

app.init()
