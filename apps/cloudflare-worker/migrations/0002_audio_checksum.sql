-- SHA-256 由浏览器声明并在 Workflow 读取对象后重新计算，避免只依赖 MIME/大小判断完整性。
ALTER TABLE analyses ADD COLUMN audio_sha256 TEXT;
