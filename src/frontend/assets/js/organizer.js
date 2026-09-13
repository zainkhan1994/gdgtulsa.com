// Organizer page: renders the Google Skills badge grids.
(function(){
  var BASE = 'assets/Google Skill Badges/google-skills-badges_';
  // Six badge images are in the repo under different filenames; the rest of
  // the artwork has never been committed, so those entries fall back to the
  // caption alone rather than rendering a broken image (see onerror below).
  var FILES = {
    'Agent Fundamentals': 'assets/badges/credentials/agent-fundamentals.png',
    'Introduction to AI Agents': 'assets/badges/credentials/intro-ai-agents.png',
    'Enterprise Agents and Use Cases': 'assets/badges/credentials/enterprise-agents.png',
    'Create Your First Gemini Enterprise Application': 'assets/badges/credentials/gemini-enterprise-app.png',
    'Machine Learning Operations (MLOps) for Generative AI': 'assets/badges/credentials/mlops-genai.png',
    'Machine Learning Operations (MLOps) with Vertex AI- Model Evaluation': 'assets/badges/credentials/mlops-vertex.png'
  };
  var GROUPS = {
    'grid-agents': [
      ['Agent Fundamentals','Agent Fundamentals'],
      ['Introduction to AI Agents','Intro to AI Agents'],
      ['Enterprise Agents and Use Cases','Enterprise Agents'],
      ['Create Your First Gemini Enterprise Application','Gemini Enterprise App'],
      ['Machine Learning Operations (MLOps) for Generative AI','MLOps for GenAI'],
      ['Machine Learning Operations (MLOps) with Vertex AI- Model Evaluation','MLOps · Vertex AI'],
    ],
    'grid-notebooklm': [
      ['AI Boost Bites- Intro to NotebookLM','Intro to NotebookLM'],
      ['AI Boost Bites- Discover Sources in NotebookLM','Discover Sources'],
      ['AI Boost Bites- NotebookLM for Market Research','Market Research'],
      ['AI Boost Bites- NotebookLM Mind Maps','Mind Maps'],
      ['AI Boost Bites- NotebookLM Reports','Reports'],
      ['AI Boost Bites- NotebookLM Video Overviews','Video Overviews'],
      ['AI Boost Bites- Project Notebooks','Project Notebooks'],
      ['AI Boost Bites- Research Hacks with NotebookLM','Research Hacks'],
    ],
    'grid-workspace': [
      ['AI Boost Bites- Advanced Analysis in Sheets','Advanced Sheets'],
      ['AI Boost Bites- AI Magic in a Sheets Cell','AI Magic in Sheets'],
      ['AI Boost Bites- AI Power-Ups for Google Workspace','Workspace Power-Ups'],
      ['AI Boost Bites- Amplify Exec Voices with AI','Amplify Exec Voices'],
      ['AI Boost Bites- Build Slides Fast with Gemini','Build Slides Fast'],
      ['AI Boost Bites- Create Docs in Seconds','Create Docs Fast'],
      ["AI Boost Bites- Create ‘What If’ Scenarios with AI","'What If' Scenarios"],
      ['AI Boost Bites- Create Your Own Productivity Tools','Productivity Tools'],
      ['AI Boost Bites- Email Content Creation','Email Creation'],
      ['AI Boost Bites- Find the Story in Your Data','Data Storytelling'],
      ['AI Boost Bites- Gemini Calendar Hacks in Gmail','Calendar Hacks'],
      ['AI Boost Bites- Gemini Slide Summaries','Slide Summaries'],
      ['AI Boost Bites- No-Code Sheets & Scripts','No-Code Sheets'],
      ['AI Boost Bites- Notes to Sheets with Gemini','Notes to Sheets'],
      ['AI Boost Bites- Presentation Scripts with Gemini','Presentation Scripts'],
      ['AI Boost Bites- Streamline Event Planning with AI','Event Planning AI'],
      ['AI Boost Bites- Talk to Your Data in Sheets','Talk to Your Data'],
    ],
    'grid-creative': [
      ['AI Boost Bites- Animated Charts with Gemini','Animated Charts'],
      ['AI Boost Bites- Become a -Vibe DJ-','Vibe DJ'],
      ['AI Boost Bites- Become a Creative Mashup Artist','Creative Mashup'],
      ['AI Boost Bites- Become an AI Art Director for Your World','AI Art Director'],
      ['AI Boost Bites- Build a Personalized Weather App','Weather App'],
      ['AI Boost Bites- Create a 3D Solar System','3D Solar System'],
      ['AI Boost Bites- Create the Perfect Portrait','Perfect Portrait'],
      ['AI Boost Bites- Create Your Own Retro Arcade Game','Retro Arcade Game'],
      ['AI Boost Bites- Create Your Ultimate College Scouting Report','College Scouting'],
      ['AI Boost Bites- From Napkin Sketch to Functional App','Napkin to App'],
      ["AI Boost Bites- Get Your Competitor’s Playbook in Minutes","Competitor's Playbook"],
      ['AI Boost Bites- Make Any Big Purchase with Confidence','Smart Purchases'],
      ['AI Boost Bites- One-Click Campaign Visuals','Campaign Visuals'],
      ['AI Boost Bites- Supercharge Research with Gemini','Supercharge Research'],
      ['AI Boost Bites- Turn Your Ideas into Animated Art','Animated Art'],
      ['AI Boost Bites- Your Personal AI Tutor','Personal AI Tutor'],
      ['AI Boost Bites- Your Personal Feedback Agent','Feedback Agent'],
    ]
  };
  Object.keys(GROUPS).forEach(function(id){
    var grid = document.getElementById(id);
    if(!grid) return;
    GROUPS[id].forEach(function(pair){
      var fig = document.createElement('figure');
      fig.className = 'badge-band-item';
      var img = document.createElement('img');
      img.src = FILES[pair[0]] || (BASE + pair[0] + '.png');
      img.alt = pair[1] + ' badge';
      img.loading = 'lazy';
      // Missing artwork drops the image and keeps the caption, so the badge
      // still reads as a credential instead of a broken-image icon.
      img.addEventListener('error', function(){
        fig.classList.add('badge-band-item--no-art');
        img.remove();
      });
      var cap = document.createElement('span');
      cap.textContent = pair[1];
      fig.appendChild(img);
      fig.appendChild(cap);
      grid.appendChild(fig);
    });
  });
})();
