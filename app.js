const app = {
  settings: null,
  sessionId: null,
  data: {
    subjects: [],
    state: {
      currentSub: null,
      lastType: null,
      tempExamType: null,
      totalQ: 0,
      questions: [],
      questionIds: [],
      key: {},
      answers: {},
      bookmarks: new Set(),
      timeLeft: 0,
      timer: null,
      isReview: false,
      isSubmitted: false,
      mode: 'exam',
      filterMode: 'all',
      file: null,
      startedAt: 0,
      countdownTimer: null
    }
  },
  
  particleCtx: null,
  animationFrame: null,

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
    this.initParticles()
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
    const html = document.documentElement
    if (html.classList.contains('dark')) {
      html.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    } else {
      html.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    }
  },

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
    const code = prompt(sub.lockNote || `Môn ${sub.name} đang khóa. Nhập mã để mở:`) || ''
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
    const code = prompt(lockInfo.note || 'Nhập mã để mở:') || ''
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
      'hk': { t: 90, q: null, name: 'Thi THPT QG', level: 'Mức độ Khó' }
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
    if (!grid) return
    grid.innerHTML = this.data.subjects.map(s => {
      const locked = (s.locked ?? this.settings.lockedByDefaultSubject) && !this.isSubjectUnlocked(s.id)
      return `
        <div onclick="app.selectSubject('${s.id}')" class="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 hover:border-primary-500 hover:shadow-md cursor-pointer transition-all h-36 flex flex-col items-center justify-center gap-2 active:scale-95 group ${locked ? 'opacity-60' : ''}">
          <div class="w-14 h-14 ${s.color} rounded-full flex items-center justify-center text-white shadow-md group-hover:scale-110 transition-transform relative">
            <i class="fa-solid ${s.icon} text-xl"></i>
          </div>
          <div class="text-center">
            <div class="font-bold text-sm md:text-base">${s.name}</div>
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
    const defaultCounts = { '15m': 10, '45m': 30, 'gk1': 40, 'ck1': 50, 'gk2': 40, 'ck2': 50, 'hk': 50 }

    await Promise.all(tiles.map(async tile => {
      const type = tile.dataset.examType
      const cfg = this.getExamConfig(sub, type)
      const lockInfo = cfg.lockInfo || {}
      const locked = (lockInfo.locked ?? this.settings.lockedByDefaultExam ?? false) && !this.isExamUnlocked(sub.id, type)

      tile.classList.toggle('opacity-75', locked)
      const badge = tile.querySelector('.exam-locked-badge')
      if (badge) badge.classList.toggle('hidden', !locked)

      const h3 = tile.querySelector('h3')
      if (cfg.title && h3) h3.textContent = cfg.title

      let qCount = cfg.q
      if (qCount == null) {
        const bank = await this.loadQuestionBank(cfg.file)
        if (bank && bank.length > 0) {
          qCount = bank.length
        } else {
          qCount = defaultCounts[type] || 0
        }
      }

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

  goToCountdown() {
      this.switchView('thpt-2026')
      this.startCountdown()
  },

  startCountdown() {
    clearInterval(this.data.state.countdownTimer)
    
    const update = () => {
        const targetDate = new Date('2026-06-11T07:30:00').getTime()
        const now = new Date().getTime()
        const distance = targetDate - now

        if (distance < 0) {
            document.getElementById('cd-days').innerText = "00"
            document.getElementById('cd-hours').innerText = "00"
            document.getElementById('cd-minutes').innerText = "00"
            document.getElementById('cd-seconds').innerText = "00"
            return
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24))
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((distance % (1000 * 60)) / 1000)

        const elDays = document.getElementById('cd-days')
        const elHours = document.getElementById('cd-hours')
        const elMinutes = document.getElementById('cd-minutes')
        const elSeconds = document.getElementById('cd-seconds')

        if(elDays) elDays.innerText = String(days).padStart(2, '0')
        if(elHours) elHours.innerText = String(hours).padStart(2, '0')
        if(elMinutes) elMinutes.innerText = String(minutes).padStart(2, '0')
        if(elSeconds) elSeconds.innerText = String(seconds).padStart(2, '0')
    }

    update()
    this.data.state.countdownTimer = setInterval(update, 1000)
  },

  openModeModal() {
    document.getElementById('mode-modal').classList.remove('hidden')
  },

  closeModeModal() {
    document.getElementById('mode-modal').classList.add('hidden')
  },

  confirmStart(mode) {
    this.closeModeModal()
    if (this.data.state.tempExamType) {
        this.startExam(this.data.state.tempExamType, true, mode)
    }
  },

  onExamTileClick(type) {
    const sub = this.data.state.currentSub
    if (!sub) return
    const cfg = this.getExamConfig(sub, type)
    const lockInfo = cfg.lockInfo || {}
    const locked = (lockInfo.locked ?? this.settings.lockedByDefaultExam ?? false) && !this.isExamUnlocked(sub.id, type)
    if (locked) {
      this.tryUnlockExam(sub, type, { ...lockInfo, name: cfg.name }).then(ok => {
        if (ok) {
            this.data.state.tempExamType = type
            this.openModeModal()
        }
      })
      return
    }
    this.data.state.tempExamType = type
    this.openModeModal()
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
      startedAt: st.startedAt,
      mode: st.mode
    }
    localStorage.setItem(key, JSON.stringify(payload))
  },

  clearExamSession(subId, type) {
    const key = this.sessionKey(subId, type)
    localStorage.removeItem(key)
  },

  async startExam(type, forceNew = false, mode = 'exam') {
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
    const saved = forceNew ? null : this.loadExamSession(key)

    let questions = []
    let questionIds = []
    let timeLeft = cfg.t * 60
    let answers = {}
    let bookmarks = new Set()
    let startedAt = Date.now()
    let currentMode = mode

    if (saved && !saved.isSubmitted && saved.file === cfg.file && Array.isArray(saved.questionIds) && saved.questionIds.length > 0) {
        currentMode = saved.mode || mode
        questionIds = saved.questionIds.filter(i => i >= 0 && i < bank.length)
        questions = questionIds.map(i => bank[i])
        timeLeft = typeof saved.timeLeft === 'number' ? saved.timeLeft : timeLeft
        answers = saved.answers || {}
        bookmarks = new Set(saved.bookmarks || [])
        startedAt = saved.startedAt
    }

    const finalSeedTime = (saved && !forceNew) ? saved.startedAt : Date.now()
    const seedString = `${this.sessionId}|${sub.id}|${type}|${cfg.file}|${finalSeedTime}`
    const seed = this.hashSeed(seedString)
    const rng = this.rngMulberry32(seed)

    if (questionIds.length === 0) {
      const indices = Array.from({ length: bank.length }, (_, i) => i)
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        const tmp = indices[i]
        indices[i] = indices[j]
        indices[j] = tmp
      }
      const limit = cfg.q ? cfg.q : bank.length
      const takeN = Math.min(limit, indices.length)
      questionIds = indices.slice(0, takeN)
    }

    const shuffledQuestions = questionIds.map(i => {
      const originalQ = bank[i]
      const qCopy = JSON.parse(JSON.stringify(originalQ))
      const originalOpts = this.getOptions(qCopy)
      
      if (originalOpts.length > 0) {
        for (let k = originalOpts.length - 1; k > 0; k--) {
          const r = Math.floor(rng() * (k + 1))
          const tmp = originalOpts[k]
          originalOpts[k] = originalOpts[r]
          originalOpts[r] = tmp
        }
        if (qCopy.answeroption) qCopy.answeroption = originalOpts
        else if (qCopy.options) qCopy.options = originalOpts
      }
      return qCopy
    })

    const keyMap = {}
    shuffledQuestions.forEach((q, idx) => {
      const opts = this.getOptions(q)
      keyMap[idx + 1] = this.getCorrectIndex(opts)
    })

    questions = shuffledQuestions

    clearInterval(this.data.state.timer)

    this.data.state = {
      currentSub: sub,
      lastType: type,
      totalQ: questions.length,
      questions: questions,
      questionIds: questionIds, 
      key: keyMap,
      answers: answers,
      bookmarks: bookmarks,
      timeLeft: timeLeft,
      timer: null,
      isReview: false,
      isSubmitted: false,
      file: cfg.file,
      startedAt: startedAt,
      filterMode: 'all',
      mode: currentMode,
      countdownTimer: this.data.state.countdownTimer
    }

    if (forceNew) this.data.state.mode = mode

    this.saveExamSession()

    document.getElementById('quiz-title-display').innerText = sub.name
    document.getElementById('quiz-status-text').innerText = `${cfg.name} • ${questions.length} câu`

    const trainingBadge = document.getElementById('training-mode-badge')
    if (trainingBadge) {
        if (this.data.state.mode === 'training') trainingBadge.classList.remove('hidden')
        else trainingBadge.classList.add('hidden')
    }

    document.getElementById('timer-container').classList.remove('hidden')
    document.getElementById('mobile-action-bar').classList.remove('hidden')
    document.getElementById('desktop-action-area').classList.remove('hidden')

    this.switchView('quiz')
    this.renderQuestions()
    this.renderPalette()
    this.updateTimerDisplay()
    this.startTimer()
  },

  resetQuiz() {
    if(confirm('Bạn có muốn làm lại bài từ đầu?')) {
       this.startExam(this.data.state.lastType, true, this.data.state.mode)
    }
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
    document.getElementById('timer').innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  },

  setFilter(mode) {
    this.data.state.filterMode = mode
    this.renderQuestions()
  },

  renderQuestions() {
    const st = this.data.state
    const wrap = document.getElementById('questions-container')

    let filterHtml = ''
    if (st.isReview) {
        const btnClass = (mode) => `px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${st.filterMode === mode ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'}`
        filterHtml = `
        <div class="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border-b border-gray-200/50 dark:border-gray-700/50 py-2 -mx-4 px-4 mb-4 flex items-center gap-3 overflow-x-auto no-scrollbar">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0"><i class="fa-solid fa-filter mr-1"></i>Lọc KQ:</div>
            <button onclick="app.setFilter('all')" class="${btnClass('all')} shrink-0">Tất cả</button>
            <button onclick="app.setFilter('wrong')" class="${btnClass('wrong')} shrink-0">Câu Sai</button>
            <button onclick="app.setFilter('bookmarked')" class="${btnClass('bookmarked')} shrink-0">Đã Lưu</button>
        </div>`
    }

    const questionHtml = st.questions.map((q, i) => {
      const qi = i + 1
      const opts = this.getOptions(q)
      const userAns = st.answers[qi]
      const correctIdx = st.key[qi]
      const isBookmarked = st.bookmarks.has(qi)
      const isWrong = userAns != undefined && Number(userAns) !== correctIdx || (st.isSubmitted && userAns == undefined)

      if (st.filterMode === 'wrong' && !isWrong) return ''
      if (st.filterMode === 'bookmarked' && !isBookmarked) return ''

      const hint = q.hint || q.suggestion || ''
      const hintBox = (hint && !st.isReview) ? `
         <div class="mt-2 mb-4">
            <button onclick="app.toggleElement('hint-content-${qi}')" 
                class="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-full transition-all hover:bg-amber-100 dark:hover:bg-amber-900/30 active:scale-95 shadow-sm">
                <i class="fa-regular fa-lightbulb text-sm"></i>
                <span>Gợi ý</span>
            </button>
            <div id="hint-content-${qi}" class="hidden mt-3 p-3 bg-amber-50/80 dark:bg-[#1f1d15] text-sm text-slate-700 dark:text-slate-300 rounded-2xl border border-amber-100 dark:border-amber-900/30 leading-relaxed animate-fade-in shadow-sm">
               ${hint}
            </div>
         </div>
      ` : ''

      let explainText = q.explain || q.explanation || ''
      if (!explainText && opts.length > 0) {
          const correctOpt = opts.find(o => o.isCorrect === true)
          if (correctOpt && correctOpt.rationale) {
              explainText = correctOpt.rationale
          }
      }

      const isShowResult = st.isReview || (st.mode === 'training' && userAns != undefined)

      const explainBox = (explainText && isShowResult) ? `
        <div id="explain-box-${qi}" class="mt-4 border-t border-slate-100 dark:border-slate-700/50 pt-4 animate-fade-in">
          <button onclick="app.toggleExplanation(${qi})" class="w-full flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 px-4 py-3 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            <span><i class="fa-solid fa-book-open text-emerald-500 mr-2"></i>Giải thích chi tiết</span>
            <i id="explain-icon-${qi}" class="fa-solid fa-chevron-down rotate-icon transition-transform duration-300 open"></i>
          </button>
          <div id="explain-content-${qi}" class="explanation-content mt-3 text-sm text-slate-600 dark:text-slate-300 bg-emerald-50 dark:bg-emerald-900/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/30 leading-relaxed open">
            ${explainText}
          </div>
        </div>
      ` : ''

      const optionsHtml = opts.map((o, oi) => {
        const isChecked = userAns == oi ? 'checked' : ''
        let reviewClass = ""
        let reviewIcon = ""

        if (isShowResult) {
           if (oi === correctIdx) {
             reviewClass = "!border-green-500 !bg-green-50 dark:!bg-green-900/20"
             reviewIcon = `<div class="ml-auto text-green-600 dark:text-green-400 font-bold text-[10px] uppercase tracking-wider bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">Đúng</div>`
           } else if (userAns == oi && oi !== correctIdx) {
             reviewClass = "!border-red-500 !bg-red-50 dark:!bg-red-900/20"
             reviewIcon = `<div class="ml-auto text-red-600 dark:text-red-400 font-bold text-[10px] uppercase tracking-wider bg-red-100 dark:bg-red-900/40 px-2 py-0.5 rounded">Sai</div>`
           } else {
             reviewClass = "opacity-50 grayscale"
           }
        }

        return `
          <label class="relative w-full block mb-3 cursor-pointer group select-none">
            <input type="radio" name="q${qi}" value="${oi}" 
                   class="peer sr-only" 
                   onchange="app.onAnswer(${qi}, ${oi})" 
                   ${isChecked} 
                   ${(st.isReview || (st.mode === 'training' && userAns != undefined)) ? 'disabled' : ''}>

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

      return `
        <div id="q-${qi}" class="bg-white dark:bg-[#1e293b] p-5 md:p-6 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm mb-6 transition-all hover:shadow-md animate-fade-in">
          
          <div class="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100 dark:border-slate-700/50">
            <span class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest bg-slate-100 dark:bg-slate-700/50 px-2 py-1 rounded">
              Câu ${qi}
            </span>
            <button onclick="app.toggleBookmark(${qi})" class="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 group">
              <i id="bookmark-icon-${qi}" class="fa-solid fa-bookmark text-lg transition-colors ${isBookmarked ? 'text-yellow-500' : 'text-slate-300 dark:text-slate-600 group-hover:text-yellow-400'}"></i>
            </button>
          </div>

          <div class="text-lg font-semibold text-slate-800 dark:text-slate-100 leading-relaxed mb-4">
            ${q.text || q.question || ''}
          </div>
          
          ${hintBox}

          <div class="space-y-1">
            ${optionsHtml}
          </div>
          
          ${explainBox}
        </div>
      `
    }).join('')

    let content = filterHtml + questionHtml
    if (questionHtml.trim() === '') {
        content += `<div class="text-center py-20 text-slate-400">Không có câu hỏi nào phù hợp với bộ lọc này.</div>`
    }

    wrap.innerHTML = content
    
    if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise()
    }
    this.updateProgress()
  },

  renderPalette() {
    const st = this.data.state
    const buildButtons = (containerId) => {
      const cont = document.getElementById(containerId)
      if(!cont) return
      cont.innerHTML = Array.from({ length: st.totalQ }, (_, i) => {
        const qi = i + 1
        const userAns = st.answers[qi]
        const correctIdx = st.key[qi]
        
        let cls = 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-transparent hover:border-slate-300 dark:hover:border-slate-500'
        if (userAns != undefined) {
          cls = 'bg-blue-600 text-white shadow-md shadow-blue-500/30 border-2 border-blue-400 ring-1 ring-blue-600/50' 
        }

        if (st.isReview) {
          if (userAns == undefined) cls = 'bg-slate-200 dark:bg-slate-800 text-slate-400 opacity-50'
          else if (Number(userAns) === correctIdx) cls = 'bg-emerald-500 text-white shadow-sm border border-emerald-400'
          else cls = 'bg-red-500 text-white shadow-sm border border-red-400'
        } else if (st.mode === 'training' && userAns != undefined) {
          if (Number(userAns) === correctIdx) cls = 'bg-emerald-500 text-white shadow-sm border border-emerald-400'
          else cls = 'bg-red-500 text-white shadow-sm border border-red-400'
        }
        
        const mark = st.bookmarks.has(qi) ? `<div class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-yellow-400 rounded-full border border-white dark:border-slate-800 z-10 shadow-sm"></div>` : ''
        
        return `
          <div class="relative">
            <button onclick="app.jumpToQuestion(${qi})" class="w-full h-10 rounded-xl font-bold text-sm transition-all active:scale-95 flex items-center justify-center ${cls}">${qi}</button>
            ${mark}
          </div>
        `
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
    if (st.isReview || (st.mode === 'training' && st.answers[qi] != undefined)) return
    st.answers[qi] = oi
    this.saveExamSession()
    
    if (st.mode === 'training') {
        this.renderQuestions()
    }
    this.renderPalette()
  },

  toggleBookmark(qi) {
    const st = this.data.state
    const icon = document.getElementById(`bookmark-icon-${qi}`)
    if (st.bookmarks.has(qi)) {
      st.bookmarks.delete(qi)
      if (icon) {
        icon.classList.remove('text-yellow-500')
        icon.classList.add('text-slate-300', 'dark:text-slate-600')
      }
    } else {
      st.bookmarks.add(qi)
      if (icon) {
        icon.classList.remove('text-slate-300', 'dark:text-slate-600')
        icon.classList.add('text-yellow-500')
      }
    }
    this.saveExamSession()
    this.renderPalette()
  },

  toggleElement(id) {
    const el = document.getElementById(id)
    if (el) el.classList.toggle('hidden')
  },

  toggleExplanation(qi) {
    const content = document.getElementById(`explain-content-${qi}`)
    const icon = document.getElementById(`explain-icon-${qi}`)
    if (!content || !icon) return
    content.classList.toggle('open')
    icon.classList.toggle('open')
  },

  jumpToQuestion(qi) {
    if (this.data.state.isReview && this.data.state.filterMode !== 'all') {
       this.setFilter('all')
       setTimeout(() => this.executeJump(qi), 50)
    } else {
       this.executeJump(qi)
    }
  },

  executeJump(qi) {
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

  submitExam(auto = false) {
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
    st.isReview = true 
    this.saveExamSession()

    this.switchView('result')
  },

  reviewExam() {
    const st = this.data.state
    st.isReview = true
    st.filterMode = 'all'
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
    ['home', 'select', 'quiz', 'result', 'thpt-2026'].forEach(v => {
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
  },
  
  initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width, height;
    let particles = [];

    const particleCount = window.innerWidth < 768 ? 30 : 60;
    const connectionDistance = 150;
    const moveSpeed = 0.5;

    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    class Particle {
      constructor() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * moveSpeed;
        this.vy = (Math.random() - 0.5) * moveSpeed;
        this.size = Math.random() * 2 + 1;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > width) this.vx *= -1;
        if (this.y < 0 || this.y > height) this.vy *= -1;
      }

      draw() {
        const isDark = document.documentElement.classList.contains('dark');
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(30, 41, 59, 0.3)';
        ctx.fill();
      }
    }

    const init = () => {
      resize();
      particles = [];
      for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      const isDark = document.documentElement.classList.contains('dark');
      const lineColor = isDark ? '255, 255, 255' : '99, 102, 241';

      for (let i = 0; i < particles.length; i++) {
        let p = particles[i];
        p.update();
        p.draw();
        for (let j = i; j < particles.length; j++) {
          let p2 = particles[j];
          let dx = p.x - p2.x;
          let dy = p.y - p2.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < connectionDistance) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${lineColor}, ${1 - dist / connectionDistance - 0.5})`;
            ctx.lineWidth = 1;
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(animate);
    };

    window.addEventListener('resize', () => {
        resize();
        init();
    });
    
    init();
    animate();
  }
}

app.init()
