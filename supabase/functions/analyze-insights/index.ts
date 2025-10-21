import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TEMPLATES = [
  'Standup', '1-on-1', 'User Interview', 'Customer Discovery', 
  'Pitch', 'Planning', 'Retro', 'Brainstorm', 'Status Update', 
  'Hiring Interview', 'Support Call', 'Training', 'Other'
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sessionId, transcript, overrideTemplates } = await req.json();
    console.log('Analyze insights for session:', sessionId);

    if (!sessionId || !transcript) {
      throw new Error('Missing sessionId or transcript');
    }

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Detect meeting templates
    let detectedTemplates = overrideTemplates;
    
    if (!detectedTemplates) {
      console.log('Detecting meeting templates...');
      const templatePrompt = `Analyze this meeting transcript and determine the 2 most appropriate meeting types from this list: ${TEMPLATES.join(', ')}. Return ONLY a JSON array of strings, maximum 2 templates. Example: ["Standup", "Planning"]

Transcript: ${transcript.substring(0, 2000)}`;

      const templateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: templatePrompt }],
          temperature: 0.3,
        }),
      });

      if (!templateResponse.ok) {
        console.error('Template detection failed');
        detectedTemplates = ['Other'];
      } else {
        const templateResult = await templateResponse.json();
        const content = templateResult.choices?.[0]?.message?.content || '["Other"]';
        try {
          detectedTemplates = JSON.parse(content);
        } catch {
          detectedTemplates = ['Other'];
        }
      }
    }

    console.log('Detected templates:', detectedTemplates);

    // Step 2: Generate AI title
    console.log('Generating title...');
    const titlePrompt = `Create a concise, human-friendly meeting title under 60 chars from this transcript. Prefer topic + purpose. Return raw text only.

Transcript: ${transcript.substring(0, 1500)}`;

    let generatedTitle = `Recording ${new Date().toLocaleDateString()}`;
    
    try {
      const titleResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: titlePrompt }],
          temperature: 0.7,
          max_tokens: 30,
        }),
      });

      if (titleResponse.ok) {
        const titleResult = await titleResponse.json();
        const titleContent = titleResult.choices?.[0]?.message?.content?.trim();
        if (titleContent && titleContent.length > 0 && titleContent.length <= 60) {
          generatedTitle = titleContent;
        }
      }
    } catch (error) {
      console.error('Title generation failed, using default:', error);
    }

    console.log('Generated title:', generatedTitle);

    // Update session title
    await supabase
      .from('sessions')
      .update({ title: generatedTitle })
      .eq('id', sessionId);

    // Step 3: Extract structured insights
    const insightsPrompt = `Analyze this ${detectedTemplates.join('/')} meeting transcript and extract structured insights.

Return ONLY valid JSON with this structure:
{
  "overview": "Brief 2-3 sentence summary",
  "key_topics": ["topic1", "topic2"],
  "decisions": ["decision1", "decision2"],
  "questions": ["question1"],
  "risks": ["risk1"],
  "followups": ["followup1"],
  "dates": [{"date": "2025-10-25", "context": "what's happening"}],
  "participants": ["name1", "name2"]
}

Transcript: ${transcript}`;

    console.log('Extracting insights...');

    const insightsResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: insightsPrompt }],
        temperature: 0.5,
      }),
    });

    if (!insightsResponse.ok) {
      throw new Error('Insights extraction failed');
    }

    const insightsResult = await insightsResponse.json();
    const content = insightsResult.choices?.[0]?.message?.content || '{}';
    
    let insights;
    try {
      insights = JSON.parse(content);
    } catch {
      insights = { overview: 'Analysis failed', key_topics: [], decisions: [], questions: [], risks: [], followups: [], dates: [], participants: [] };
    }

    // Save to summaries table
    const { error: upsertError } = await supabase
      .from('summaries')
      .upsert({
        session_id: sessionId,
        overview: insights.overview || null,
        key_topics: insights.key_topics || [],
        decisions: insights.decisions || [],
        questions: insights.questions || [],
        risks: insights.risks || [],
        followups: insights.followups || [],
        dates: insights.dates || [],
        participants: insights.participants || [],
        detected_templates: detectedTemplates,
      }, {
        onConflict: 'session_id'
      });

    if (upsertError) {
      console.error('Database upsert error:', upsertError);
      throw upsertError;
    }

    console.log('Insights saved to database');

    return new Response(
      JSON.stringify({
        ...insights,
        detected_templates: detectedTemplates,
        success: true,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-insights:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage, success: false }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});