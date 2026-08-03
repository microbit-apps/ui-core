namespace ui {
    /**
     * View lifecycle shared by screen-managed controls.
     */
    export interface UiView<TResult> extends UiLayoutNode {
        /**
         * Renders the view through the supplied draw surface.
         */
        render(
            surface: DrawSurface,
            assets: UiAssetResolver,
            focus?: UiFocusState,
        ): void

        /**
         * Converts focus input into the view's typed result.
         */
        handleFocusInput(result: UiFocusInputResult): TResult
    }

    /**
     * View lifecycle for controls that own a normal focus scope.
     */
    export interface UiFocusableView<TResult> extends UiView<TResult> {
        /**
         * Registers focus targets after layout has arranged this view.
         *
         * `scopeOptions` lets a parent view register this view's targets under a
         * scope the parent owns.
         */
        registerFocusTargets(
            focus: UiFocusState,
            scopeOptions?: UiFocusScopeOptions,
        ): void

        /**
         * Registers directional navigation after layout has arranged this view.
         */
        registerNavigation(controller: UiFocusInputController): void

        /**
         * Focuses the view's default target.
         */
        focusDefault(focus: UiFocusState): UiFocusSetResult
    }

    /**
     * Focusable view that a parent view can compose into a scope the parent
     * owns, so several views navigate as one.
     *
     * The parent assigns its scope with `setScopeId`, collects each child's
     * targets with `navigationRows`, and registers one navigation for the whole
     * group. Children keep rendering, measuring, and arranging themselves.
     */
    export interface UiComposableFocusView<TResult>
        extends UiFocusableView<TResult> {
        /**
         * Focus scope this view registers its targets under.
         */
        scopeId: UiFocusScopeId

        /**
         * Adopts an owner scope. Target ids are rebuilt from the new scope, so
         * this runs before any focus registration.
         */
        setScopeId(scopeId: UiFocusScopeId): void

        /**
         * Rows of navigation targets in movement order, using this view's
         * current arranged rectangles and visibility.
         */
        navigationRows(): UiFocusNavigationTarget[][]

        /**
         * Target this view would focus by default, or `undefined` when it has
         * no focusable target.
         */
        resolvePreferredTargetId(): UiFocusId | undefined
    }

    /**
     * Screen placement for a root view.
     */
    export interface UiPlacement {
        /**
         * Left edge of the placement rectangle. Defaults to `0`.
         */
        x?: number

        /**
         * Top edge of the placement rectangle. Defaults to `0`.
         */
        y?: number

        /**
         * Horizontal center of the placement rectangle. Used when `x` is omitted.
         */
        centerX?: number

        /**
         * Vertical center of the placement rectangle. Used when `y` is omitted.
         */
        centerY?: number

        /**
         * Width of the placement rectangle. Omitted values use the view's
         * measured preferred width.
         */
        width?: number

        /**
         * Height of the placement rectangle. Omitted values use the view's
         * measured preferred height.
         */
        height?: number

        /**
         * Horizontal child placement inside the rectangle. Defaults to `start`.
         */
        horizontalAlignment?: UiLayoutAlignment

        /**
         * Vertical child placement inside the rectangle. Defaults to `start`.
         */
        verticalAlignment?: UiLayoutAlignment
    }
}
