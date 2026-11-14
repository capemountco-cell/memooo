import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id, overwrite, template_hint } = await req.json();
    console.log('Extract tasks for session:', session_id);

    if (!session_id) {
      throw new Error('Missing session_id');
    }

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!openaiApiKey && !lovableApiKey) {
      throw new Error('No AI API key configured');
    }

    // Initialize Supabase client with user's JWT for RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Helper function to extract and parse JSON from AI response
    const extractJSON = (content: string) => {
      if (!content) return null;
      
      try {
        return JSON.parse(content);
      } catch {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[1]);
          } catch {}
        }
        
        // Try to find JSON array in the text
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            return JSON.parse(arrayMatch[0]);
          } catch {}
        }
      }
      
      return null;
    };

    // Get transcript
    const { data: transcripts, error: fetchError } = await supabase
      .from('transcripts')
      .select('text')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true });

    if (fetchError) {
      throw fetchError;
    }

    const transcript = transcripts?.map(t => t.text).join(' ') || '';
    
    if (!transcript) {
      throw new Error('No transcript found for session');
    }

    const templateContext = template_hint ? `This is a ${template_hint} meeting.` : '';

    const prompt = `${templateContext} Extract action items from this transcript. Each action item MUST start with a verb (Send, Schedule, Decide, Follow up, Prepare, Review, etc.). Infer owner and due date when mentioned.

Return ONLY valid JSON array:
[
  {
    "title": "Send proposal to client",
    "owner": "John",
    "due_date": "2025-10-25",
    "priority": "high"
  }
]

Priority: "low", "normal", or "high"
If owner or due_date not mentioned, omit those fields.

Transcript: ${transcript}`;

    console.log('Calling AI for task extraction...');

    let result;
    
    // Try OpenAI first if available
    if (openaiApiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are a helpful assistant that extracts action items. Each must start with a verb (Send, Schedule, Decide, Follow up, Prepare). Infer owner/due date when mentioned. Return JSON only.',
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0.3,
          }),
        });

        if (response.ok) {
          result = await response.json();
          console.log('OpenAI task extraction successful');
        } else {
          const errorText = await response.text();
          console.error('OpenAI API error:', response.status, errorText);
          throw new Error('OpenAI failed');
        }
      } catch (error) {
        console.log('OpenAI failed, falling back to Gemini:', error);
      }
    }
    
    // Fallback to Gemini if OpenAI failed or not available
    if (!result) {
      console.log('Using Gemini fallback...');
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that extracts action items. Each must start with a verb (Send, Schedule, Decide, Follow up, Prepare). Infer owner/due date when mentioned. Return JSON only.',
            },
            { role: 'user', content: prompt }
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error:', response.status, errorText);
        throw new Error('Both OpenAI and Gemini failed for task extraction');
      }

      result = await response.json();
      console.log('Gemini task extraction successful');
    }
    const content = result.choices?.[0]?.message?.content || '[]';
    console.log('Task extraction response length:', content.length);
    console.log('Task extraction response preview:', content.substring(0, 200));
    
    const extractedTasks = extractJSON(content) || [];
    
    if (!Array.isArray(extractedTasks)) {
      console.error('Extracted tasks is not an array:', extractedTasks);
      throw new Error('Invalid task extraction response format');
    }
    
    console.log('Extracted tasks count:', extractedTasks.length);

    // If overwrite, delete existing AI tasks
    if (overwrite) {
      await supabase
        .from('tasks')
        .delete()
        .eq('session_id', session_id)
        .eq('source', 'ai');
    }

    // Insert new tasks
    const tasksToInsert = extractedTasks.map((task: any) => ({
      session_id,
      title: task.title,
      owner: task.owner || null,
      due_at: task.due_date ? new Date(task.due_date).toISOString() : null,
      priority: task.priority || 'normal',
      source: 'ai',
      status: 'open',
    }));

    if (tasksToInsert.length > 0) {
      const { data: insertedTasks, error: insertError } = await supabase
        .from('tasks')
        .insert(tasksToInsert)
        .select();

      if (insertError) {
        console.error('Task insert error:', insertError);
        throw insertError;
      }

      console.log(`Inserted ${insertedTasks.length} tasks`);

      return new Response(
        JSON.stringify({ tasks: insertedTasks, success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ tasks: [], success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in extract-tasks:', error);
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