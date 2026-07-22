namespace ui.core.tests {
    class TestBitmapDisplayAdapter implements UiDisplayAdapter {
        private surface_: BitmapDrawSurface

        constructor(bitmap: Bitmap) {
            this.surface_ = new BitmapDrawSurface(bitmap)
        }

        public get surface(): BitmapDrawSurface {
            return this.surface_
        }

        public commit(): Bitmap {
            return this.surface_.bitmap
        }
    }

    /**
     * Smoke harness for primitive geometry helpers.
     */
    export function runGeometrySmokeTest(): void {
        const rect = new Rect(10, 20, 5, 7)
        control.assert(rect.inflate(2) == rect, "rect inflate returns self")
        control.assert(rect.x == 8, "rect inflate x")
        control.assert(rect.y == 18, "rect inflate y")
        control.assert(rect.width == 9, "rect inflate width")
        control.assert(rect.height == 11, "rect inflate height")

        control.assert(
            rect.union(new Rect(20, 10, 4, 5)) == rect,
            "rect union returns self",
        )
        control.assert(rect.x == 8, "rect union x")
        control.assert(rect.y == 10, "rect union y")
        control.assert(rect.width == 16, "rect union width")
        control.assert(rect.height == 19, "rect union height")
    }

    /**
     * Smoke harness for direct 160x120 viewport rendering.
     */
    export function runViewportSmokeTest(fillColor: number): void {
        const standardBitmap = bitmaps.create(
            STANDARD_DISPLAY_WIDTH,
            STANDARD_DISPLAY_HEIGHT,
        )
        const standardAdapter = new TestBitmapDisplayAdapter(standardBitmap)

        standardAdapter.surface.clear(0)
        standardAdapter.surface.fillRect(new Rect(0, 74, 160, 33), 2)
        control.assert(
            standardBitmap.getPixel(0, 74) == 2,
            "standard ui rect left",
        )
        control.assert(
            standardBitmap.getPixel(159, 106) == 2,
            "standard ui rect right",
        )
        control.assert(
            standardBitmap.getPixel(159, 107) == 0,
            "standard ui rect bottom clip",
        )

        const measuredStandard = standardAdapter.surface.measureText(
            "direct",
            bitmaps.font5,
        )
        control.assert(
            measuredStandard.width == "direct".length * bitmaps.font5.charWidth,
            "direct measure width",
        )

        const displayAdapter = new DisplayShieldFrameAdapter()
        const displaySurface = displayAdapter.surface

        displaySurface.clear(0)
        displaySurface.fillRect(new Rect(0, 0, 160, 120), fillColor)
        displaySurface.drawLine(0, 0, 159, 119, 6)
        displaySurface.drawCircle(80, 60, 18, 10)
        displaySurface.fillCircle(80, 60, 6, 5)
        displaySurface.drawBitmap(
            bmp`
        9 . . 9 . . 9
        . 9 . 9 . 9 .
        . . 9 9 9 . .
        9 9 9 9 9 9 9
        . . 9 9 9 . .
        . 9 . 9 . 9 .
        9 . . 9 . . 9
      `,
            72,
            76,
        )
        displaySurface.drawBitmap(
            bmp`
        9 9 9 9 9 9 9
        9 9 9 9 9 9 9
        9 9 . . . 9 9
        9 9 . . . 9 9
        9 9 . . . 9 9
        9 9 9 9 9 9 9
        9 9 9 9 9 9 9
      `,
            92,
            76,
        )
        displaySurface.drawText(
            `direct (${screen().width}x${screen().height})`,
            6,
            6,
            { color: 0 },
        )
        displaySurface.drawRect(new Rect(4, 4, 152, 112), 15)
        displayAdapter.commit()
    }
    class RuntimeSmokeDisplayAdapter implements UiDisplayAdapter {
        private inner_: DisplayShieldFrameAdapter
        private onCommit_: () => void

        constructor(onCommit: () => void) {
            this.inner_ = new DisplayShieldFrameAdapter()
            this.onCommit_ = onCommit
        }

        public get surface(): DrawSurface {
            return this.inner_.surface
        }

        public commit(): Bitmap {
            this.onCommit_()
            return this.inner_.commit()
        }
    }

    class RuntimeSmokeScreen extends UiScreen {
        public exitCount: number
        private prefix_: string
        private log_: (name: string) => void

        constructor(
            runtime: UiRuntime,
            prefix: string,
            backgroundColor: number,
            log: (name: string) => void,
        ) {
            super(runtime)
            this.prefix_ = prefix
            this.backgroundColor = backgroundColor
            this.log_ = log
            this.exitCount = 0
        }

        public _enter(): void {
            super._enter()
            this.log_(this.prefix_ + "enter")
        }

        public _exit(): void {
            super._exit()
            this.exitCount++
            this.log_(this.prefix_ + "exit")
        }

        public activate(): void {
            this.log_(this.prefix_ + "activate")
        }

        public deactivate(): void {
            this.log_(this.prefix_ + "deactivate")
        }

        public handleInput(event: UiInputEvent): boolean {
            if (event.action == "activate") {
                this.log_(this.prefix_ + "input")
                return true
            }
            this.log_(this.prefix_ + "handle")
            return false
        }

        public update(): void {
            this.log_(this.prefix_ + "update")
        }

        public render(surface: DrawSurface): void {
            this.log_(this.prefix_ + "render")
            surface.drawText(this.prefix_, 16, 16, { color: 15 })
        }
    }

    class AssetResolverSmoke implements UiAssetResolver {
        private known_: Bitmap
        private fallback_: Bitmap

        constructor() {
            this.known_ = bmp`7`
            this.fallback_ = bmp`1`
        }

        public getBitmap(
            id: string | number,
            nullIfMissing?: boolean,
        ): Bitmap | undefined {
            if (id == "known") return this.known_
            if (nullIfMissing) return undefined
            return this.fallback_
        }

        public getText(id: string): string {
            if (id == "label") return "Known label"
            return ""
        }
    }

    /**
     * Smoke harness for asset resolver missing-value behavior.
     */
    export function runAssetResolverSmokeTest(): void {
        const resolver = new AssetResolverSmoke()
        const known = resolver.getBitmap("known")
        const fallback = resolver.getBitmap("missing")
        const missing = resolver.getBitmap("missing", true)

        control.assert(!!known, "known bitmap exists")
        control.assert(!!fallback, "fallback bitmap exists")
        control.assert(fallback != known, "fallback is app-owned")
        control.assert(missing === undefined, "missing bitmap can be undefined")
        control.assert(resolver.getText("label") == "Known label", "known text")
        control.assert(resolver.getText("missing") == "", "missing text empty")

        const runtime = new UiRuntime(
            new RuntimeSmokeDisplayAdapter(() => {}),
            resolver,
        )
        control.assert(
            runtime.assets.getBitmap("missing") == fallback,
            "runtime fallback bitmap",
        )
        control.assert(
            runtime.assets.getBitmap("missing", true) === undefined,
            "runtime missing bitmap",
        )
        control.assert(
            runtime.assets.getText("missing") == "",
            "runtime missing text",
        )
    }

    /**
     * Smoke harness for runtime stack lifecycle and direct input delivery.
     */
    export function runRuntimeSmokeTest(): void {
        let log = ""
        const appendLog = (name: string) => {
            log += name + ";"
        }
        const display = new RuntimeSmokeDisplayAdapter(() =>
            appendLog("commit"),
        )
        const runtime = new UiRuntime(display, undefined, 0)
        const base = new RuntimeSmokeScreen(runtime, "base", 1, appendLog)
        const overlay = new RuntimeSmokeScreen(runtime, "overlay", 2, appendLog)
        const replacement = new RuntimeSmokeScreen(
            runtime,
            "replace",
            3,
            appendLog,
        )

        runtime.push(base)
        control.assert(log == "baseenter;baseactivate;", "base push order")

        runtime.push(overlay)
        control.assert(base.exitCount == 0, "covered screen not exited")
        control.assert(
            log ==
                "baseenter;baseactivate;basedeactivate;overlayenter;overlayactivate;",
            "overlay push order",
        )

        runtime.dispatchInput({ action: "activate" })
        runtime.runFrame()
        control.assert(
            log ==
                "baseenter;baseactivate;basedeactivate;overlayenter;overlayactivate;" +
                    "overlayinput;overlayupdate;overlayrender;commit;",
            "input frame order",
        )

        runtime.pop()
        control.assert(overlay.exitCount == 1, "popped screen exited")
        control.assert(runtime.top() == base, "base restored")
        control.assert(
            log ==
                "baseenter;baseactivate;basedeactivate;overlayenter;overlayactivate;" +
                    "overlayinput;overlayupdate;overlayrender;commit;" +
                    "overlaydeactivate;overlayexit;baseactivate;",
            "pop order",
        )

        runtime.dispatchInput({ action: "activate" })
        runtime.runFrame()
        control.assert(
            log ==
                "baseenter;baseactivate;basedeactivate;overlayenter;overlayactivate;" +
                    "overlayinput;overlayupdate;overlayrender;commit;" +
                    "overlaydeactivate;overlayexit;baseactivate;" +
                    "baseinput;baseupdate;baserender;commit;",
            "popped input disposed",
        )

        runtime.replace(replacement)
        control.assert(runtime.top() == replacement, "replacement active")
        runtime.pop()
        control.assert(runtime.depth() == 0, "stack empty")
    }
    class LayoutSmokeNode implements UiLayoutNode {
        public readonly layoutSpec: UiLayoutSpec
        public readonly finalRect: Rect
        public layoutDirty: boolean
        public receivedMaxWidth: number
        public receivedMaxHeight: number
        private contentMinWidth_: number
        private contentMinHeight_: number
        private contentPreferredWidth_: number
        private contentPreferredHeight_: number

        constructor(
            layoutSpec: UiLayoutSpec,
            contentMinWidth: number,
            contentMinHeight: number,
            contentPreferredWidth: number,
            contentPreferredHeight: number,
        ) {
            this.layoutSpec = layoutSpec
            this.finalRect = new Rect()
            this.layoutDirty = true
            this.receivedMaxWidth = 0
            this.receivedMaxHeight = 0
            this.contentMinWidth_ = contentMinWidth
            this.contentMinHeight_ = contentMinHeight
            this.contentPreferredWidth_ = contentPreferredWidth
            this.contentPreferredHeight_ = contentPreferredHeight
        }

        public measure(
            constraints: UiLayoutConstraints,
            output: UiMeasuredSize,
        ): void {
            this.receivedMaxWidth = constraints.maxWidth
            this.receivedMaxHeight = constraints.maxHeight
            measureLayoutSpec(
                this.layoutSpec,
                constraints,
                this.contentMinWidth_,
                this.contentMinHeight_,
                this.contentPreferredWidth_,
                this.contentPreferredHeight_,
                output,
            )
            this.clearLayoutInvalidation()
        }

        public arrange(rect: Rect): void {
            copyArrangedLayoutRect(this.finalRect, rect)
            this.clearLayoutInvalidation()
        }

        public invalidateLayout(): void {
            this.layoutDirty = true
        }

        public clearLayoutInvalidation(): void {
            this.layoutDirty = false
        }
    }

    /**
     * Smoke harness for measured layout contracts and final rectangle storage.
     */
    export function runLayoutSmokeTest(): void {
        const measured = new UiMeasuredSize()
        const contentNode = new LayoutSmokeNode(
            {
                width: { mode: "content" },
                height: { mode: "content" },
            },
            12,
            5,
            30,
            10,
        )

        contentNode.measure({ maxWidth: 40.4, maxHeight: 8.2 }, measured)
        control.assert(
            contentNode.receivedMaxWidth == 40.4,
            "content constraints width",
        )
        control.assert(
            contentNode.receivedMaxHeight == 8.2,
            "content constraints height",
        )
        control.assert(measured.minWidth == 12, "content min width")
        control.assert(measured.minHeight == 5, "content min height")
        control.assert(measured.preferredWidth == 30, "content preferred width")
        control.assert(
            measured.preferredHeight == 8,
            "content preferred height",
        )
        control.assert(!contentNode.layoutDirty, "content measure clears dirty")

        contentNode.invalidateLayout()
        control.assert(contentNode.layoutDirty, "content invalidates")
        const arranged = new Rect(3.4, 4.6, 30.2, 8.8)
        contentNode.arrange(arranged)
        arranged.set(0, 0, 1, 1)
        control.assert(contentNode.finalRect.x == 3, "content final x")
        control.assert(contentNode.finalRect.y == 5, "content final y")
        control.assert(contentNode.finalRect.width == 30, "content final width")
        control.assert(
            contentNode.finalRect.height == 9,
            "content final height",
        )

        const fixedNode = new LayoutSmokeNode(
            {
                width: { mode: "fixed", value: 99.4, min: 10, max: 44.2 },
                height: { mode: "fixed", value: -5, min: 7, max: 3 },
            },
            1,
            1,
            2,
            2,
        )

        fixedNode.measure({ maxWidth: 40.6, maxHeight: 100 }, measured)
        control.assert(measured.minWidth == 41, "fixed constrained min width")
        control.assert(
            measured.preferredWidth == 41,
            "fixed constrained preferred width",
        )
        control.assert(measured.minHeight == 7, "fixed constrained min height")
        control.assert(
            measured.preferredHeight == 7,
            "fixed constrained preferred height",
        )

        fixedNode.arrange(new Rect(-2.2, 6.6, -8, 12.3))
        control.assert(fixedNode.finalRect.x == -2, "fixed final x")
        control.assert(fixedNode.finalRect.y == 7, "fixed final y")
        control.assert(fixedNode.finalRect.width == 0, "fixed final width")
        control.assert(fixedNode.finalRect.height == 12, "fixed final height")

        const fillNode = new LayoutSmokeNode(
            {
                width: { mode: "fill", min: 4 },
                height: { mode: "fill", max: 6.2 },
            },
            2,
            3,
            11,
            9,
        )

        fillNode.measure({ maxWidth: 50, maxHeight: 50 }, measured)
        control.assert(measured.minWidth == 4, "fill min width")
        control.assert(measured.preferredWidth == 11, "fill preferred width")
        control.assert(measured.minHeight == 3, "fill min height")
        control.assert(measured.preferredHeight == 6, "fill preferred height")

        measureLayoutSpec(
            undefined,
            { maxWidth: 50, maxHeight: 50 },
            6,
            4,
            14,
            9,
            measured,
        )
        control.assert(measured.minWidth == 6, "missing spec min width")
        control.assert(
            measured.preferredWidth == 14,
            "missing spec preferred width",
        )
        control.assert(measured.minHeight == 4, "missing spec min height")
        control.assert(
            measured.preferredHeight == 9,
            "missing spec preferred height",
        )
    }

    /**
     * Smoke harness for the build-time localization runtime.
     */
    export function runLocTest(): void {
        // Identity path: no catalog means source strings pass through.
        _loc.table = undefined
        _loc.defaultFont = undefined
        control.assert(loc("Hello") == "Hello", "loc identity no table")
        control.assert(
            locf("Hi {0}", ["Sam"]) == "Hi Sam",
            "locf identity no table",
        )
        control.assert(locc("relay", "on") == "on", "locc identity no table")

        // Table hit and fallback-on-miss.
        _loc.table = {
            Hello: "Bonjour",
            "LED {0} {1}": "{1} {0} DEL",
        }
        control.assert(loc("Hello") == "Bonjour", "loc table hit")
        control.assert(loc("Missing") == "Missing", "loc fallback on miss")

        // locc: composite key, plain-string fallback, English fallback.
        _loc.table = {
            "relay#on": "MARCHE",
            on: "activee",
        }
        control.assert(locc("relay", "on") == "MARCHE", "locc composite hit")
        control.assert(
            locc("switch", "on") == "activee",
            "locc plain-string fallback",
        )
        control.assert(
            locc("switch", "off") == "off",
            "locc source fallback",
        )

        // locf: interpolation with reordered placeholders in translation.
        _loc.table = {
            "LED {0} {1}": "{1} {0} DEL",
        }
        control.assert(
            locf("LED {0} {1}", ["red", "on"]) == "on red DEL",
            "locf reordered interpolation",
        )
        control.assert(
            locf("Plain {0}", ["x"]) == "Plain x",
            "locf missing key interpolation",
        )

        // locFont: default font8 shape when unset, assigned font when set.
        _loc.table = undefined
        _loc.defaultFont = undefined
        const fallbackFont = locFont()
        control.assert(
            fallbackFont.charWidth == bitmaps.font8.charWidth,
            "locFont default char width",
        )
        control.assert(
            fallbackFont.charHeight == bitmaps.font8.charHeight,
            "locFont default char height",
        )

        const customFont: TextFont = {
            charWidth: 3,
            charHeight: 5,
            data: hex``,
        }
        _loc.defaultFont = customFont
        control.assert(locFont() == customFont, "locFont returns assigned font")

        // Reset so ordering does not leak state to other tests.
        _loc.table = undefined
        _loc.defaultFont = undefined
    }

    runGeometrySmokeTest()
    runViewportSmokeTest(2)
    runAssetResolverSmokeTest()
    runRuntimeSmokeTest()
    runLayoutSmokeTest()
    runLocTest()

    control.__log(1, "All tests passed!")
}
