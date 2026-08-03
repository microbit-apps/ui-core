namespace ui {
    /**
     * Options for a screen with view-managed focus and modal routing.
     */
    export interface UiScreenOptions {
        /**
         * Optional scroll request sink used by focus movement.
         */
        scroll?: UiFocusScrollHandler

        /**
         * Default measurement limits used when opening modals without options.
         */
        modalConstraints?: UiLayoutConstraints
    }

    /**
     * Screen that can be pushed onto a runtime stack.
     */
    export class UiScreen {
        /**
         * Palette color used to clear before rendering. Omitted screens use the
         * runtime clear color.
         */
        public backgroundColor: number
        private options_: UiScreenOptions
        private runtime_: UiRuntime
        private focus_: UiFocusState
        private focusInput_: UiFocusInputController
        private roots_: UiScreenRoot<any>[]
        private activeModal_: UiModal<any>
        private modalConstraints_: UiLayoutConstraints
        private rootConstraints_: UiLayoutConstraints
        private modalRect_: Rect
        private modalSize_: UiMeasuredSize
        private entered_: boolean

        constructor(runtime: UiRuntime, options?: UiScreenOptions) {
            this.options_ = options || {}
            this.runtime_ = runtime
            this.backgroundColor = undefined
            this.focus_ = new UiFocusState()
            this.focusInput_ = new UiFocusInputController(
                this.focus_,
                this.options_.scroll,
            )
            this.roots_ = []
            this.activeModal_ = undefined
            this.modalConstraints_ = {
                maxWidth: 0,
                maxHeight: 0,
            }
            this.rootConstraints_ = {
                maxWidth: 0,
                maxHeight: 0,
            }
            this.modalRect_ = new Rect()
            this.modalSize_ = new UiMeasuredSize()
            this.entered_ = false
        }

        /**
         * Asset resolver from the active runtime.
         */
        public get assets(): UiAssetResolver {
            return this.runtime_.assets
        }

        /**
         * Runtime that owns this screen.
         */
        public get runtime(): UiRuntime {
            return this.runtime_
        }

        /**
         * Focus state owned by this screen.
         */
        public get focus(): UiFocusState {
            return this.focus_
        }

        /**
         * Focus input controller owned by this screen.
         */
        public get focusInput(): UiFocusInputController {
            return this.focusInput_
        }


        /**
         * Whether this screen currently owns an open modal.
         */
        public get hasModal(): boolean {
            return !!this.activeModal_
        }

        /**
         * Adds a root view rendered and routed by this screen.
         */
        public add<TView extends UiView<any>>(
            view: TView,
            placement?: UiPlacement,
        ): TView {
            const root = createScreenRoot(view, placement)
            _uiCore.resolveContentAssets(view, this.assets)
            this.roots_.push(root)
            if (placement && (this.entered_ || this.hasExplicitSize(placement)))
                this.arrangeRoot(root)
            if (this.entered_) {
                this.registerRoot(root)
                if (this.focus_.getActiveScopeId() === undefined)
                    this.focusFirstRoot()
            }
            return view
        }

        /**
         * Adds a root view in a horizontally centered band.
         */
        public addCentered<TView extends UiView<any>>(
            view: TView,
            centerY: number,
            width: number,
            height: number,
        ): TView {
            return this.add(view, {
                x: 0,
                centerY,
                width,
                height,
                horizontalAlignment: "center",
                verticalAlignment: "center",
            })
        }

        /**
         * Removes a previously added root view. Returns true when the view was
         * found and removed. Cleans up the view's focus scope and navigation
         * when it registered one.
         */
        public remove<TView extends UiView<any>>(view: TView): boolean {
            let index = -1
            for (let i = 0; i < this.roots_.length; i++) {
                if (this.roots_[i].view === view) {
                    index = i
                    break
                }
            }
            if (index < 0) return false
            this.roots_.splice(index, 1)
            const focusable = <any>view
            if (
                focusable.registerFocusTargets &&
                focusable.scopeId !== undefined
            ) {
                this.focusInput_.clearNavigation(focusable.scopeId)
                this.focus_.removeScope(focusable.scopeId)
            }
            return true
        }

        /**
         * Called after the screen has been pushed onto a runtime stack.
         */
        public _enter(): void {
            this.closeModal()
            this.focus_ = new UiFocusState()
            this.focusInput_ = new UiFocusInputController(
                this.focus_,
                this.options_.scroll,
            )
            this.entered_ = true
            this.resolveRootConstraints()
            this.resolveModalConstraints()
            for (let i = 0; i < this.roots_.length; i++) {
                const root = this.roots_[i]
                if (root.placement) this.arrangeRoot(root)
                this.registerRoot(root)
            }
            this.focusFirstRoot()
        }

        /**
         * Called after the screen is removed from the stack.
         */
        public _exit(): void {
            this.closeModal()
            this.entered_ = false
            this.focus_ = new UiFocusState()
            this.focusInput_ = new UiFocusInputController(
                this.focus_,
                this.options_.scroll,
            )
        }

        /**
         * Called when the screen becomes the active top screen.
         */
        public activate(): void {}

        /**
         * Called before another screen becomes active over this screen.
         */
        public deactivate(): void {}

        /**
         * Routes one input event through modal, screen, and focus handling.
         */
        public routeInput(event: UiInputEvent): boolean {
            if (this.activeModal_) return this.handleModalInput(event)
            const screenHandled = this.handleInput(event)
            if (screenHandled !== undefined) return screenHandled
            const result = this.focusInput_.handleInput(event)
            const handled = this.handleRootFocusInput(result)
            return handled !== undefined ? handled : result.handled
        }

        /**
         * Updates state after input delivery and before rendering.
         */
        public update(): void {}

        /**
         * Renders this screen's views and active modal.
         */
        public render(surface: DrawSurface): void {
            this.renderViews(surface)
        }

        /**
         * Opens a modal using screen-sized constraints by default.
         */
        public openModal<TResult>(
            modal: UiModal<TResult>,
            options?: UiModalOpenOptions,
        ): UiFocusSetResult {
            if (this.activeModal_) this.closeModal()
            _uiCore.resolveContentAssets(modal, this.assets)
            this.arrangeModal(modal, options)
            this.activeModal_ = modal
            return modal.open(this.focus_, this.focusInput_)
        }

        /**
         * Closes the active modal.
         */
        public closeModal<TResult>(
            modal?: UiModal<TResult>,
        ): UiFocusSetResult | undefined {
            const target = modal || this.activeModal_
            if (!target) return undefined
            const modalScopeId = target.modalScopeId
            const result = target.close(this.focus_)
            this.focusInput_.clearNavigation(modalScopeId)
            this.focus_.removeScope(modalScopeId)
            if (
                this.activeModal_ &&
                this.activeModal_.modalScopeId == modalScopeId
            )
                this.activeModal_ = undefined
            return result
        }

        /**
         * Handles screen-level input before root views receive it.
         */
        public handleInput(event: UiInputEvent): boolean | undefined {
            return undefined
        }

        private renderViews(surface: DrawSurface): void {
            for (let i = 0; i < this.roots_.length; i++) {
                this.roots_[i].view.render(surface, this.assets, this.focus_)
            }
            if (this.activeModal_)
                this.activeModal_.render(surface, this.assets, this.focus_)
        }

        private registerRoot<TResult>(root: UiScreenRoot<TResult>): void {
            const view = <any>root.view
            if (!view.registerFocusTargets) return
            view.registerFocusTargets(this.focus_)
            view.registerNavigation(this.focusInput_)
        }

        private arrangeRoot<TResult>(root: UiScreenRoot<TResult>): void {
            const placement = root.placement
            const hasWidth = placement.width !== undefined
            const hasHeight = placement.height !== undefined
            let width = hasWidth
                ? _uiLayout.sanitizeDimension(placement.width)
                : this.rootConstraints_.maxWidth
            let height = hasHeight
                ? _uiLayout.sanitizeDimension(placement.height)
                : this.rootConstraints_.maxHeight
            root.constraints.maxWidth = width
            root.constraints.maxHeight = height
            root.view.measure(root.constraints, root.measured)
            if (!hasWidth) width = root.measured.preferredWidth
            if (!hasHeight) height = root.measured.preferredHeight
            root.rect.set(
                this.placementX(placement, width),
                this.placementY(placement, height),
                width,
                height,
            )
            root.constraints.maxWidth = width
            root.constraints.maxHeight = height
            const horizontal = placement.horizontalAlignment || "start"
            const vertical = placement.verticalAlignment || "start"
            const childWidth = _uiLayout.alignedSize(
                width,
                root.measured.preferredWidth,
                horizontal,
            )
            const childHeight = _uiLayout.alignedSize(
                height,
                root.measured.preferredHeight,
                vertical,
            )
            root.childRect.set(
                _uiLayout.alignedOffset(
                    root.rect.x,
                    width,
                    childWidth,
                    horizontal,
                ),
                _uiLayout.alignedOffset(
                    root.rect.y,
                    height,
                    childHeight,
                    vertical,
                ),
                childWidth,
                childHeight,
            )
            root.view.arrange(root.childRect)
        }

        private hasExplicitSize(placement: UiPlacement): boolean {
            return (
                placement.width !== undefined && placement.height !== undefined
            )
        }

        private placementX(placement: UiPlacement, width: number): number {
            if (placement.x !== undefined)
                return _uiLayout.sanitizeCoordinate(placement.x)
            if (placement.centerX !== undefined)
                return (
                    _uiLayout.sanitizeCoordinate(placement.centerX) -
                    Math.idiv(width, 2)
                )
            return 0
        }

        private placementY(placement: UiPlacement, height: number): number {
            if (placement.y !== undefined)
                return _uiLayout.sanitizeCoordinate(placement.y)
            if (placement.centerY !== undefined)
                return (
                    _uiLayout.sanitizeCoordinate(placement.centerY) -
                    Math.idiv(height, 2)
                )
            return 0
        }

        private arrangeModal<TResult>(
            modal: UiModal<TResult>,
            options?: UiModalOpenOptions,
        ): void {
            if (options && options.rect) {
                modal.arrange(options.rect)
                return
            }

            const constraints = options
                ? options.constraints
                : this.modalConstraints_
            if (!constraints) return

            modal.measure(constraints, this.modalSize_)
            this.modalRect_.set(
                Math.idiv(
                    constraints.maxWidth - this.modalSize_.preferredWidth,
                    2,
                ),
                Math.idiv(
                    constraints.maxHeight - this.modalSize_.preferredHeight,
                    2,
                ),
                this.modalSize_.preferredWidth,
                this.modalSize_.preferredHeight,
            )
            modal.arrange(this.modalRect_)
        }

        private handleModalInput(event: UiInputEvent): boolean {
            const result = this.focusInput_.handleInput(event)
            const modal = this.activeModal_
            const modalResult = modal.handleFocusInput(result)
            if (modalResult) {
                if (
                    this.activeModal_ == modal &&
                    this.shouldCloseModalForResult(modalResult)
                )
                    this.closeModal(modal)
                const handled = this.defaultHandled(modalResult)
                return handled !== undefined ? handled : result.handled
            }
            return result.handled
        }

        private handleRootFocusInput(
            result: UiFocusInputResult,
        ): boolean | undefined {
            for (let i = 0; i < this.roots_.length; i++) {
                const view = this.roots_[i].view
                if (!(<any>view).registerFocusTargets) continue
                const viewResult = (<any>view).handleFocusInput(result)
                if (viewResult) return this.defaultHandled(viewResult)
            }
            return undefined
        }

        /**
         * Focuses the first root that can take focus. Roots whose targets are
         * all hidden, and container views that own no scope, are skipped rather
         * than swallowing the screen's initial focus.
         */
        private focusFirstRoot(): UiFocusSetResult | undefined {
            let firstResult: UiFocusSetResult | undefined = undefined
            for (let i = 0; i < this.roots_.length; i++) {
                const view = this.roots_[i].view
                if (!(<any>view).registerFocusTargets) continue
                const result = <UiFocusSetResult>(
                    (<any>view).focusDefault(this.focus_)
                )
                if (result && result.kind == "focused") return result
                if (!firstResult) firstResult = result
            }
            return firstResult
        }

        private defaultHandled<TResult>(result: TResult): boolean | undefined {
            const kind = (<any>result).kind
            switch (kind) {
                case "activated":
                case "cancelled":
                case "closed":
                case "custom":
                case "deleted":
                case "completed":
                    return true
            }
            return undefined
        }

        private shouldCloseModalForResult<TResult>(result: TResult): boolean {
            const kind = (<any>result).kind
            switch (kind) {
                case "cancelled":
                case "closed":
                case "custom":
                case "deleted":
                case "completed":
                    return true
                case "activated":
                    return (<any>result).close === true
            }
            return false
        }

        private resolveRootConstraints(): void {
            this.rootConstraints_.maxWidth = STANDARD_DISPLAY_WIDTH
            this.rootConstraints_.maxHeight = STANDARD_DISPLAY_HEIGHT
        }

        private resolveModalConstraints(): void {
            if (this.options_.modalConstraints) {
                this.modalConstraints_.maxWidth =
                    this.options_.modalConstraints.maxWidth
                this.modalConstraints_.maxHeight =
                    this.options_.modalConstraints.maxHeight
                return
            }

            this.modalConstraints_.maxWidth = STANDARD_DISPLAY_WIDTH
            this.modalConstraints_.maxHeight = STANDARD_DISPLAY_HEIGHT
        }
    }

    interface UiScreenRoot<TResult> {
        view: UiView<TResult>
        placement: UiPlacement
        rect: Rect
        childRect: Rect
        constraints: UiLayoutConstraints
        measured: UiMeasuredSize
    }

    function createScreenRoot<TResult>(
        view: UiView<TResult>,
        placement?: UiPlacement,
    ): UiScreenRoot<TResult> {
        return {
            view,
            placement,
            rect: new Rect(),
            childRect: new Rect(),
            constraints: { maxWidth: 0, maxHeight: 0 },
            measured: new UiMeasuredSize(),
        }
    }

    interface UiScreenInput {
        runtime: UiRuntime
        disposed: boolean
    }

    interface UiScreenRecord {
        screen: UiScreen
        input: UiScreenInput
    }

    function assertScreenRuntime(runtime: UiRuntime, screen: UiScreen): void {
        control.assert(screen.runtime == runtime)
    }

    function createScreenInput(runtime: UiRuntime): UiScreenInput {
        return {
            runtime,
            disposed: false,
        }
    }

    function disposeScreenInput(input: UiScreenInput): void {
        input.disposed = true
    }

    function dispatchScreenInput(
        input: UiScreenInput,
        action: UiInputAction,
        source?: UiInputSource,
        phase?: UiInputPhase,
    ): void {
        if (input.disposed) return
        input.runtime.dispatchInput({ action, source, phase })
    }

    function releaseControllerButtons(): void {
        controller.up.setPressed(false)
        controller.down.setPressed(false)
        controller.left.setPressed(false)
        controller.right.setPressed(false)
        controller.A.setPressed(false)
        controller.B.setPressed(false)
        controller.menu.setPressed(false)
    }

    /**
     * Stack that owns screen lifecycle and input routing.
     */
    export class UiScreenStack {
        private runtime_: UiRuntime
        private screens_: UiScreenRecord[]
        private contextActive_: boolean

        constructor(runtime: UiRuntime) {
            this.runtime_ = runtime
            this.screens_ = []
            this.contextActive_ = false
        }

        /**
         * Pushes a screen and makes it active.
         */
        public push(screen: UiScreen): void {
            assertScreenRuntime(this.runtime_, screen)
            this.runtime_.clearInputQueue()

            const current = this.topRecord()
            if (current) current.screen.deactivate()

            this.ensureEventContext()
            const input = createScreenInput(this.runtime_)
            releaseControllerButtons()
            this.bindControllerActions(input)

            const record: UiScreenRecord = { screen, input }
            this.screens_.push(record)

            screen._enter()
            screen.activate()
        }

        /**
         * Removes the active screen and reactivates the screen below it. Returns
         * `undefined` when the stack is empty.
         */
        public pop(): UiScreen | undefined {
            this.runtime_.clearInputQueue()

            const record = this.screens_.pop()
            if (!record) return undefined

            record.screen.deactivate()
            record.screen._exit()
            disposeScreenInput(record.input)
            releaseControllerButtons()

            const current = this.topRecord()
            if (current) {
                this.bindControllerActions(current.input)
                current.screen.activate()
            } else {
                this.popEventContext()
            }

            return record.screen
        }

        /**
         * Replaces the active screen without reactivating the screen below it.
         * Returns `undefined` when the stack is empty.
         */
        public replace(screen: UiScreen): UiScreen | undefined {
            assertScreenRuntime(this.runtime_, screen)
            this.runtime_.clearInputQueue()

            const replaced = this.screens_.pop()
            if (replaced) {
                replaced.screen.deactivate()
                replaced.screen._exit()
                disposeScreenInput(replaced.input)
            }

            this.ensureEventContext()
            const input = createScreenInput(this.runtime_)
            releaseControllerButtons()
            this.bindControllerActions(input)

            const record: UiScreenRecord = { screen, input }
            this.screens_.push(record)

            screen._enter()
            screen.activate()

            return replaced ? replaced.screen : undefined
        }

        /**
         * Returns the active screen, or `undefined` when the stack is empty.
         */
        public top(): UiScreen | undefined {
            const record = this.topRecord()
            return record ? record.screen : undefined
        }

        /**
         * Returns the number of screens in the stack.
         */
        public depth(): number {
            return this.screens_.length
        }

        /**
         * Delivers queued input, updates, renders, and commits the active screen.
         */
        public runFrame(
            queue: UiInputEvent[],
            display: UiDisplayAdapter,
            clearColor: number,
        ): void {
            if (!this.topRecord()) {
                this.clearInputQueue(queue)
                return
            }

            this.deliverQueuedInput(queue)

            const active = this.topRecord()
            if (!active) {
                this.clearInputQueue(queue)
                return
            }

            active.screen.update()

            const color =
                active.screen.backgroundColor !== undefined
                    ? active.screen.backgroundColor
                    : clearColor
            display.surface.clear(color)
            active.screen.render(display.surface)
            display.commit()
        }

        private deliverQueuedInput(queue: UiInputEvent[]): void {
            const record = this.topRecord()
            if (!record) {
                this.clearInputQueue(queue)
                return
            }

            let index = 0
            while (index < queue.length && this.topRecord() == record) {
                const event = queue[index++]
                record.screen.routeInput(event)
            }

            this.clearInputQueue(queue)
        }

        private topRecord(): UiScreenRecord | undefined {
            if (!this.screens_.length) return undefined
            return this.screens_[this.screens_.length - 1]
        }

        private clearInputQueue(queue: UiInputEvent[]): void {
            while (queue.length) queue.pop()
        }

        private ensureEventContext(): void {
            if (this.contextActive_) return
            context.pushEventContext()
            this.contextActive_ = true
        }

        private popEventContext(): void {
            if (!this.contextActive_) return
            context.popEventContext()
            this.contextActive_ = false
        }

        private bindControllerActions(input: UiScreenInput): void {
            this.bindControllerAction(input, controller.up.id, "up")
            this.bindControllerAction(input, controller.down.id, "down")
            this.bindControllerAction(input, controller.left.id, "left")
            this.bindControllerAction(input, controller.right.id, "right")
            this.bindControllerAction(input, controller.A.id, "activate")
            this.bindControllerAction(input, controller.B.id, "cancel")
            this.bindControllerAction(input, controller.menu.id, "menu")
        }

        private bindControllerAction(
            input: UiScreenInput,
            buttonId: number,
            action: UiInputAction,
        ): void {
            context.onEvent(ControllerButtonEvent.Pressed, buttonId, () => {
                dispatchScreenInput(input, action, "controller", "pressed")
            })
            context.onEvent(ControllerButtonEvent.Released, buttonId, () => {
                dispatchScreenInput(input, action, "controller", "released")
            })
            context.onEvent(ControllerButtonEvent.Repeated, buttonId, () => {
                dispatchScreenInput(input, action, "controller", "repeated")
            })
        }
    }
}

namespace _uiCore {
    export let resolveContentAssets = function (
        view: ui.UiView<any>,
        assets: ui.UiAssetResolver,
    ): void {}
}
