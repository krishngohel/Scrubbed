require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const supabase = require('../supabase');
const NOW = new Date().toISOString();

const updates = [
  {
    slug: 'ut-southwestern',
    prompts: [
      { prompt_id: 'utsw-1', prompt_text: 'Describe a group project or activity that you are most proud of. Consider the following in your response: What aspect makes you most proud? How was it accomplished? How did you deal with disagreement or conflict in the group? How did you get fellow group members to embrace a position or view your perspective?', word_limit: 500, limit_text: '2,500 characters' },
      { prompt_id: 'utsw-2', prompt_text: 'Describe a time that you have witnessed someone acting unethically or dishonestly, or experienced behavior of harassment or discrimination. What did you do? Describe your reaction — is there anything you might do differently now in retrospect?', word_limit: 500, limit_text: '2,500 characters' },
      { prompt_id: 'utsw-3', prompt_text: 'Describe an interaction or experience that has made you more sensitive or appreciative of cultural differences, and/or how you have committed yourself to understanding and aiding in the pursuit of equity and inclusion in your academic, professional, or personal life.', word_limit: 500, limit_text: '2,500 characters' },
      { prompt_id: 'utsw-4', prompt_text: 'Have you engaged in any public service activities for a duration of one year or greater in length (examples: Military, Peace Corps, Teach for America, etc.)? If so, please describe the experience and impact on your personal and professional development.', word_limit: 500, limit_text: '2,500 characters (optional)' },
      { prompt_id: 'utsw-5', prompt_text: 'Please explain any academic discrepancies or extenuating circumstances that you feel the Admissions Committee should know.', word_limit: 500, limit_text: '2,500 characters (optional)' },
    ],
  },
  {
    slug: 'baylor-com',
    prompts: [
      { prompt_id: 'bcm-1', prompt_text: 'Please select up to two areas of interest you may want to pursue during your medical studies (Clinical Research | Healthcare disparities/medically underserved communities | Academic Medicine | Community Health | Simulation in medical education | Health systems science | Telehealth | Advocacy). What knowledge, skills, and attitudes have you developed that have prepared you for this career path?', word_limit: 200, limit_text: '1,000 characters' },
      { prompt_id: 'bcm-2', prompt_text: 'Indicate any special experiences, unusual factors, or other information you feel would be helpful in evaluating you, including but not limited to education, employment, extracurricular activities, or prevailing over adversity. You may expand upon but not repeat TMDSAS or AMCAS application information. This section is mandatory — your application will not be reviewed without it.', word_limit: 400, limit_text: '2,000 characters (required)' },
    ],
  },
  {
    slug: 'mcgovern-uthealth',
    prompts: [
      { prompt_id: 'mcgovern-1', prompt_text: 'Please discuss one of the following and answer: Why was it challenging? How did you handle it? Knowing what you know now, would you do anything differently? What did you learn?\n• A challenging situation or obstacle you have faced in the past\n• Any academic road bumps in your academic career (low academic performance, failing course, dropping/retaking of courses)', word_limit: 500, limit_text: '2,500 characters' },
      { prompt_id: 'mcgovern-2', prompt_text: 'Describe a time or situation where you have been unsuccessful or failed. What did you learn from this experience and how have you applied this learning to your work and/or life?', word_limit: 500, limit_text: '2,500 characters' },
      { prompt_id: 'mcgovern-3', prompt_text: 'From what you understand about the rigors of medical school, what do you think will be the biggest challenge for you? How do you think you are prepared for these challenges?', word_limit: 500, limit_text: '2,500 characters' },
      { prompt_id: 'mcgovern-4', prompt_text: 'What hesitations or reservations, if any, do you have about joining the medical profession?', word_limit: 500, limit_text: '2,500 characters' },
    ],
  },
  {
    slug: 'texas-am',
    prompts: [
      { prompt_id: 'tamu-1', prompt_text: 'As a physician, you never know what type of patient you will serve. From your past experiences, please describe or highlight factors or situations that demonstrate your ability to work with individuals from multicultural communities.', word_limit: 700, limit_text: '3,500 characters' },
      { prompt_id: 'tamu-2', prompt_text: 'The Texas A&M School of Medicine embraces the Aggie Core Values of Respect, Excellence, Leadership, Loyalty, Integrity, and Selfless Service. Please elaborate on personal characteristics, values, accomplishments, and/or experiences that demonstrate your potential to contribute to the school and to the profession of medicine.', word_limit: 700, limit_text: '3,500 characters' },
      { prompt_id: 'tamu-3', prompt_text: 'Describe any circumstances indicative of some hardship, such as financial difficulties, personal or family illness, a medical condition, a death in the immediate family, or educational disadvantage not mentioned in your primary application essays; OR describe any key academic, personal, or financial barriers that COVID-19 may have posed on you or your immediate family.', word_limit: 700, limit_text: '3,500 characters' },
    ],
  },
  {
    slug: 'dell-medical',
    prompts: [
      { prompt_id: 'dell-1', prompt_text: 'Dell Med uses a video secondary (no written essays). Approximately 20% of applicants receive an email invitation to record 3 video responses — 2 minutes each, prompts revealed immediately before recording with no re-dos. Prepare by reflecting on Dell Med\'s mission to disrupt health, build community, and change medicine. Video prompts are confidential and not shared publicly.', word_limit: null, limit_text: 'Video — 2 min/response (invite-only)' },
    ],
  },
  {
    slug: 'texas-tech-lubbock',
    prompts: [
      { prompt_id: 'lubbock-1', prompt_text: 'Areas of Interest — select all that apply and list relevant experiences (completed, current, or planned): Practice in an underserved area and/or work with an underserved population | Rural/Border health | Medical Research/Academics | Primary Care | Other.', word_limit: 150, limit_text: '150 words per selected area' },
      { prompt_id: 'lubbock-2', prompt_text: 'Describe a meaningful setback in your academic, professional, or personal journey. How did you respond, and how has that experience shaped your habits, skills, and mindset for medical school success?', word_limit: 250, limit_text: '250 words' },
      { prompt_id: 'lubbock-3', prompt_text: 'Choose one core value — One Team, Kindhearted, Integrity, Visionary, or Beyond Service — that represents your greatest strength. Explain why and how it contributes to your success and impact in medical school.', word_limit: 250, limit_text: '250 words' },
      { prompt_id: 'lubbock-4', prompt_text: 'Please share your ideal practice: preferred location, patient population, and specialty.', word_limit: 100, limit_text: '100 words' },
    ],
  },
  {
    slug: 'texas-tech-el-paso',
    prompts: [
      { prompt_id: 'elpaso-1', prompt_text: 'The mission of TTUHSC El Paso Paul L. Foster School of Medicine is to provide an outstanding education and development opportunities for a diverse group of students, residents, faculty, and staff; advance knowledge through innovation and research; and serve the needs of our socially and culturally diverse communities and region. Recognizing that PLFSOM is located on the US/Mexico border, please describe why you are interested in applying to our school.', word_limit: 300, limit_text: '300 words' },
      { prompt_id: 'elpaso-2', prompt_text: 'The Foster SOM Honor Code states that students will uphold the dignity of the medical profession, avoid actions which might result in harm to patients, protect patient dignity and confidential information, not lie, cheat, or steal, and enter professional relationships in a manner reflective of high professional standards. Please describe past experiences or personal attributes that reflect your affinity with this honor code.', word_limit: 300, limit_text: '300 words' },
      { prompt_id: 'elpaso-3', prompt_text: 'Please describe any unique personal experiences or disadvantage (educational, financial, or otherwise) and their significance to you in your pursuit of a medical degree.', word_limit: 300, limit_text: '300 words' },
    ],
  },
  {
    slug: 'unthsc-tcom',
    prompts: [
      { prompt_id: 'tcom-1', prompt_text: 'What experiences and/or relationships have motivated you toward a career in osteopathic medicine?', word_limit: 400, limit_text: '2,000 characters' },
      { prompt_id: 'tcom-2', prompt_text: 'Please select a specific instance where you have demonstrated Courageous Integrity and describe how this is indicative of your character. (Courageous Integrity = modeling exceptional standards: building trust through honest, transparent, and authentic actions; providing and accepting constructive feedback; holding yourself and others accountable.)', word_limit: 400, limit_text: '2,000 characters' },
    ],
  },
];

(async () => {
  for (const { slug, prompts } of updates) {
    const { error } = await supabase.from('schools')
      .update({ prompts, prompts_updated_at: NOW })
      .eq('slug', slug);
    if (error) console.error('Error updating', slug, ':', error.message);
    else console.log('Updated', slug, '-', prompts.length, 'prompt(s)');
  }
  console.log('Done.');
  process.exit(0);
})();
