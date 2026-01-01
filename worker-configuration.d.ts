interface Env {
  RUNNING_IN_DOCKER: Settings;
  DEFAULT_NUM_CTX: Settings;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  GROQ_API_KEY: string;
  HuggingFace_API_KEY: string;
  OPEN_ROUTER_API_KEY: string;
  OLLAMA_API_BASE_URL: string;
  OPENAI_LIKE_API_KEY: string;
  OPENAI_LIKE_API_BASE_URL: string;
  OPENAI_LIKE_API_MODELS: string;
  TOGETHER_API_KEY: string;
  TOGETHER_API_BASE_URL: string;
  DEEPSEEK_API_KEY: string;
  LMSTUDIO_API_BASE_URL: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  MISTRAL_API_KEY: string;
  XAI_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  AWS_BEDROCK_CONFIG: string;

  /**
   * SaaS Supabase configuration for remote projects & chats persistence.
   *
   * These are intentionally separate from the user-facing Supabase integration
   * (VITE_SUPABASE_*) that the AI agent uses when helping users with their own
   * databases.
   */
  SAAS_SUPABASE_URL: string;
  SAAS_SUPABASE_SERVICE_ROLE_KEY: string;
  SAAS_SUPABASE_STORAGE_BUCKET: string;
}
