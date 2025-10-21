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
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!openaiApiKey && !lovableApiKey) {
      throw new Error('No AI API key configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Helper function to extract and parse JSON from AI response
    const extractJSON = (content: string) => {
      if (!content) return null;
      
      // Try direct parse first
      try {
        return JSON.parse(content);
      } catch {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[1]);
          } catch {
            console.error('Failed to parse JSON from markdown block');
          }
        }
        
        // Try to find JSON object in the text
        const objectMatch = content.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          try {
            return JSON.parse(objectMatch[0]);
          } catch {
            console.error('Failed to parse JSON object from text');
          }
        }
        
        // Try to find JSON array in the text
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            return JSON.parse(arrayMatch[0]);
          } catch {
            console.error('Failed to parse JSON array from text');
          }
        }
      }
      
      return null;
    };

    // Helper function to call AI with fallback
    const callAI = async (messages: any[], temperature = 0.3, maxTokens?: number) => {
      // Try OpenAI first if available
      if (openaiApiKey) {
        try {
          const body: any = {
            model: 'gpt-4o-mini',
            messages,
            temperature,
          };
          if (maxTokens) body.max_tokens = maxTokens;

          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });
          
          if (response.ok) {
            const result = await response.json();
            console.log('OpenAI response received');
            return result;
          } else {
            const errorText = await response.text();
            console.error('OpenAI API error:', response.status, errorText);
          }
        } catch (error) {
          console.error('OpenAI failed, falling back to Gemini:', error);
        }
      }
      
      // Fallback to Gemini via Lovable AI
      console.log('Using Gemini fallback...');
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error:', response.status, errorText);
        throw new Error('Both OpenAI and Gemini failed');
      }
      
      const result = await response.json();
      console.log('Gemini response received');
      return result;
    };

    // Step 1: Detect meeting templates
    let detectedTemplates = overrideTemplates;
    
    if (!detectedTemplates) {
      console.log('Detecting meeting templates...');
      const templatePrompt = `Analyze this meeting transcript and determine the 2 most appropriate meeting types from this list: ${TEMPLATES.join(', ')}. Return ONLY a JSON array of strings, maximum 2 templates. Example: ["Standup", "Planning"]

Transcript: ${transcript.substring(0, 2000)}`;

      try {
        const templateResult = await callAI([{ role: 'user', content: templatePrompt }], 0.3);
        const content = templateResult.choices?.[0]?.message?.content || '["Other"]';
        console.log('Template detection response:', content.substring(0, 200));
        const parsed = extractJSON(content);
        detectedTemplates = parsed || ['Other'];
      } catch (error) {
        console.error('Template detection failed:', error);
        detectedTemplates = ['Other'];
      }
    }

    console.log('Detected templates:', detectedTemplates);

    // Step 2: Generate AI title
    console.log('Generating title...');
    const titlePrompt = `Create a concise, human-friendly meeting title under 60 chars from this transcript. Prefer topic + purpose. Return raw text only.

Transcript: ${transcript.substring(0, 1500)}`;

    let generatedTitle = `Recording ${new Date().toLocaleDateString()}`;
    
    try {
      const titleResult = await callAI([{ role: 'user', content: titlePrompt }], 0.7, 30);
      const titleContent = titleResult.choices?.[0]?.message?.content?.trim();
      if (titleContent && titleContent.length > 0 && titleContent.length <= 60) {
        generatedTitle = titleContent;
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

    // Step 3: Format transcript for readability
    console.log('Formatting transcript...');
    const formatPrompt = `Format this meeting transcript into readable, structured paragraphs. Break it into natural sections with proper paragraph breaks. Make it look like professional typed notes. Keep all the content but organize it clearly. Return ONLY the formatted text, no extra commentary.

Transcript: ${transcript}`;

    let formattedTranscript = transcript;
    
    try {
      const formatResult = await callAI([{ role: 'user', content: formatPrompt }], 0.3);
      const formatted = formatResult.choices?.[0]?.message?.content?.trim();
      if (formatted && formatted.length > 0) {
        formattedTranscript = formatted;
      }
    } catch (error) {
      console.error('Transcript formatting failed, using original:', error);
    }

    // Update transcript with formatted version
    await supabase
      .from('transcripts')
      .update({ text: formattedTranscript })
      .eq('session_id', sessionId);

    console.log('Transcript formatted and updated');

    // Step 4: Extract structured insights
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

Transcript: ${formattedTranscript}`;

    console.log('Extracting insights...');

    const insightsResult = await callAI([{ role: 'user', content: insightsPrompt }], 0.5);
    const content = insightsResult.choices?.[0]?.message?.content || '{}';
    console.log('Insights response length:', content.length);
    console.log('Insights response preview:', content.substring(0, 300));
    
    const insights = extractJSON(content) || { 
      overview: 'Unable to parse AI response. Please try refreshing the analysis.', 
      key_topics: [], 
      decisions: [], 
      questions: [], 
      risks: [], 
      followups: [], 
      dates: [], 
      participants: [] 
    };
    
    if (!insights.overview || insights.overview === 'Unable to parse AI response. Please try refreshing the analysis.') {
      console.error('Failed to extract valid insights from AI response');
    }

    // Save to summaries table - first check if exists
    const { data: existingSummary } = await supabase
      .from('summaries')
      .select('id')
      .eq('session_id', sessionId)
      .maybeSingle();

    let upsertError;
    
    if (existingSummary) {
      // Update existing
      const { error } = await supabase
        .from('summaries')
        .update({
          overview: insights.overview || null,
          key_topics: insights.key_topics || [],
          decisions: insights.decisions || [],
          questions: insights.questions || [],
          risks: insights.risks || [],
          followups: insights.followups || [],
          dates: insights.dates || [],
          participants: insights.participants || [],
          detected_templates: detectedTemplates,
        })
        .eq('session_id', sessionId);
      upsertError = error;
    } else {
      // Insert new
      const { error } = await supabase
        .from('summaries')
        .insert({
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
        });
      upsertError = error;
    }

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