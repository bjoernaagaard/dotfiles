# Configuration

Load environment-specific values at process boundaries into a typed settings object. Validate once at startup and pass settings or focused configuration to components.

Pydantic Settings is a recommendation for Pydantic-based applications, not a Python requirement.

```python
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")
    database_url: str = Field(alias="DATABASE_URL")
    debug: bool = Field(default=False, alias="DEBUG")
```

Required secrets have no committed default. Local `.env` files stay ignored; `.env.example` contains names and safe placeholders. Production secrets should come from the deployment platform's secret mechanism. Mounted secret files may use `secrets_dir` when supported by the settings library.

Use prefixes or nested settings to group related variables. Document variable name, meaning, type, required status, and safe default. Avoid scattered `os.getenv()` calls because they defer validation and hide dependencies.

A module-level settings instance is acceptable for simple applications but complicates tests and import-time behavior. Dependency injection or an application factory is preferred when tests need multiple configurations or startup can fail under import.

Don't log secret values or include them in validation errors. Validate relationships between fields, such as production mode requiring explicit origins and secure credentials.
