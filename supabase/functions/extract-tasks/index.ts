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
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    console.log('Calling OpenAI for task extraction...');

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

    if (!response.ok) {
      throw new Error('Task extraction failed');
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '[]';
    
    let extractedTasks;
    try {
      extractedTasks = JSON.parse(content);
    } catch {
      extractedTasks = [];
    }

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