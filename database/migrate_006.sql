-- Dimensions originales de l'image (pixels natifs après deskew)
ALTER TABLE page ADD COLUMN IF NOT EXISTS image_width  INTEGER;
ALTER TABLE page ADD COLUMN IF NOT EXISTS image_height INTEGER;
