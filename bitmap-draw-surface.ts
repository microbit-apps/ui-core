namespace ui {
    /**
     * Draw surface backed by a bitmap using 160x120 pixels.
     */
    export class BitmapDrawSurface implements DrawSurface {
        private bitmap_: Bitmap

        constructor(bitmap: Bitmap) {
            this.bitmap_ = bitmap
        }

        /**
         * Physical bitmap that receives drawing operations.
         */
        public get bitmap(): Bitmap {
            return this.bitmap_
        }

        /**
         * Fills the bitmap with a palette color.
         */
        public clear(color: number): void {
            this.bitmap_.fill(color)
        }

        /**
         * Fills a rectangle after clipping it to the display bounds.
         */
        public fillRect(rect: Rect, color: number): void {
            this.fillClippedRect(rect.x, rect.y, rect.width, rect.height, color)
        }

        /**
         * Draws a rectangle outline.
         */
        public drawRect(rect: Rect, color: number): void {
            const x = rect.x
            const y = rect.y
            const width = rect.width
            const height = rect.height
            if (width <= 0 || height <= 0) return

            this.bitmap_.drawRect(x, y, width, height, color)
        }

        /**
         * Draws a one-pixel rounded rectangle.
         */
        public drawRoundedRect(
            rect: Rect,
            color?: number,
            fillColor?: number,
        ): void {
            if (fillColor !== undefined) {
                if (rect.width > 2 && rect.height > 2) {
                    this.fillClippedRect(
                        rect.x + 1,
                        rect.y,
                        rect.width - 2,
                        1,
                        fillColor,
                    )
                    this.fillClippedRect(
                        rect.x,
                        rect.y + 1,
                        rect.width,
                        rect.height - 2,
                        fillColor,
                    )
                    this.fillClippedRect(
                        rect.x + 1,
                        rect.y + rect.height - 1,
                        rect.width - 2,
                        1,
                        fillColor,
                    )
                } else {
                    this.fillRect(rect, fillColor)
                }
            }
            if (color === undefined || rect.width <= 1 || rect.height <= 1)
                return

            this.drawLine(
                rect.x + 1,
                rect.y,
                rect.x + rect.width - 2,
                rect.y,
                color,
            )
            this.drawLine(
                rect.x + 1,
                rect.y + rect.height - 1,
                rect.x + rect.width - 2,
                rect.y + rect.height - 1,
                color,
            )
            this.drawLine(
                rect.x,
                rect.y + 1,
                rect.x,
                rect.y + rect.height - 2,
                color,
            )
            this.drawLine(
                rect.x + rect.width - 1,
                rect.y + 1,
                rect.x + rect.width - 1,
                rect.y + rect.height - 2,
                color,
            )
        }

        /**
         * Draws a line.
         */
        public drawLine(
            x0: number,
            y0: number,
            x1: number,
            y1: number,
            color: number,
        ): void {
            this.bitmap_.drawLine(x0, y0, x1, y1, color)
        }

        /**
         * Draws a circle outline.
         */
        public drawCircle(
            cx: number,
            cy: number,
            radius: number,
            color: number,
        ): void {
            const r = radius
            if (r <= 0) return
            this.bitmap_.drawCircle(cx, cy, r, color)
        }

        /**
         * Fills a circle.
         */
        public fillCircle(
            cx: number,
            cy: number,
            radius: number,
            color: number,
        ): void {
            const r = radius
            if (r <= 0) return
            this.bitmap_.fillCircle(cx, cy, r, color)
        }

        /**
         * Draws a bitmap at upper-left pixel coordinates.
         */
        public drawBitmap(
            bitmap: Bitmap,
            x: number,
            y: number,
            options?: DrawBitmapOptions,
        ): void {
            const transparent = !options || options.transparent !== false
            if (transparent) this.bitmap_.drawTransparentBitmap(bitmap, x, y)
            else this.bitmap_.drawBitmap(bitmap, x, y)
        }

        /**
         * Draws text at upper-left pixel coordinates.
         */
        public drawText(
            text: string,
            x: number,
            y: number,
            options?: DrawTextOptions,
        ): void {
            const font = this.textFont(text, options ? options.font : undefined)
            const color =
                options && options.color !== undefined ? options.color : 15
            this.bitmap_.print(text, x, y, color, <any>font)
        }

        /**
         * Measures text in pixels for the selected font.
         */
        public measureText(text: string, font?: TextFont): Size {
            const selectedFont = this.textFont(text, font)
            let currentWidth = 0
            let maxWidth = 0
            let lineCount = 1

            for (let i = 0; i < text.length; i++) {
                if (text.charCodeAt(i) == 10) {
                    maxWidth = Math.max(maxWidth, currentWidth)
                    currentWidth = 0
                    lineCount++
                } else {
                    currentWidth += selectedFont.charWidth
                }
            }

            maxWidth = Math.max(maxWidth, currentWidth)
            return new Size(
                maxWidth,
                lineCount * selectedFont.charHeight + (lineCount - 1) * 2,
            )
        }

        /**
         * Clips to the viewport and fills. `protected` so a subclass that
         * mirrors to a second display can extend the one place every filled
         * span passes through: `fillRect` and `drawRoundedRect` both route
         * here, so an override catches their spans without reimplementing
         * either shape.
         */
        protected fillClippedRect(
            x: number,
            y: number,
            width: number,
            height: number,
            color: number,
        ): void {
            const x0 = Math.max(0, x)
            const y0 = Math.max(0, y)
            const x1 = Math.min(STANDARD_DISPLAY_WIDTH, x + width)
            const y1 = Math.min(STANDARD_DISPLAY_HEIGHT, y + height)
            if (x0 >= x1 || y0 >= y1) return

            this.bitmap_.fillRect(x0, y0, x1 - x0, y1 - y0, color)
        }

        /**
         * `protected` so a mirroring subclass resolves the same font this
         * surface drew with, rather than resolving it a second way.
         */
        protected textFont(text: string, font?: TextFont): TextFont {
            if (font) return font
            return bitmaps.getFontForText(text)
        }
    }
}
