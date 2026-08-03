namespace ui {
    /**
     * Stable id for a focusable target.
     */
    export type UiFocusId = string

    /**
     * Stable id for a group of related focus targets.
     */
    export type UiFocusScopeId = string

    /**
     * Application-defined id for the scrollable area that owns a target.
     */
    export type UiFocusScrollOwnerId = string

    /**
     * Direction of a requested focus move.
     */
    export type UiFocusDirection = "up" | "down" | "left" | "right"

    /**
     * Reference to one focus target in one focus scope.
     */
    export interface UiFocusTargetReference {
        /**
         * Scope that owns the target.
         */
        scopeId: UiFocusScopeId

        /**
         * Target to focus.
         */
        targetId: UiFocusId
    }

    /**
     * Request to bring a focused target into view.
     */
    export interface UiFocusScrollRequest {
        /**
         * Scope that owns the focused target.
         */
        scopeId: UiFocusScopeId

        /**
         * Target that should be visible.
         */
        targetId: UiFocusId

        /**
         * Scrollable area that should bring the target into view.
         */
        scrollOwnerId: UiFocusScrollOwnerId

        /**
         * Logical target rectangle to make visible.
         *
         * For scroll-owned targets this rectangle is in the scroll owner's content
         * coordinates. Targets without a separate content rectangle use their
         * viewport `rect`.
         */
        targetRect: Rect

        /**
         * Focus is the reason for this scroll request.
         */
        reason: "focus"
    }

    /**
     * Target descriptor used by focus state operations.
     */
    export interface UiFocusTargetOptions {
        /**
         * Stable id for this target.
         */
        id: UiFocusId

        /**
         * Scope that owns this target.
         */
        scopeId: UiFocusScopeId

        /**
         * Final target rectangle in pixel coordinates.
         */
        rect: Rect

        /**
         * Whether focus and activation ignore this target.
         */
        hidden?: boolean

        /**
         * Whether `activate()` can return an activated result for this target.
         */
        activatable?: boolean

        /**
         * Scrollable area to include in focus scroll requests for this target.
         */
        scrollOwnerId?: UiFocusScrollOwnerId

        /**
         * Optional rectangle used for scroll requests.
         */
        scrollRect?: Rect
    }

    /**
     * Scope descriptor used by focus state operations.
     */
    export interface UiFocusScopeOptions {
        /**
         * Stable id for this scope.
         */
        id: UiFocusScopeId

        /**
         * Optional parent scope id for nested focus scopes.
         */
        parentScopeId?: UiFocusScopeId

        /**
         * Target to focus when this scope is activated with no stored active target.
         */
        preferredTargetId?: UiFocusId

        /**
         * Whether `cancel()` returns a handled result for this scope.
         */
        handlesCancel?: boolean

        /**
         * Whether this scope blocks focus operations outside its descendant scopes
         * while it is active.
         */
        modal?: boolean
    }

    /**
     * Result returned by focus-setting operations.
     */
    export type UiFocusSetResult =
        | {
              kind: "focused"
              scopeId: UiFocusScopeId
              targetId: UiFocusId
              previousScopeId?: UiFocusScopeId
              previousTargetId?: UiFocusId
              scrollRequest?: UiFocusScrollRequest
          }
        | {
              kind: "cleared"
              scopeId?: UiFocusScopeId
              previousScopeId?: UiFocusScopeId
              previousTargetId?: UiFocusId
          }
        | {
              kind: "unchanged"
              scopeId?: UiFocusScopeId
              targetId?: UiFocusId
              reason: "alreadyFocused" | "alreadyClear" | "empty"
          }
        | {
              kind: "rejected"
              scopeId?: UiFocusScopeId
              targetId?: UiFocusId
              reason:
                  | "missingTargetReference"
                  | "missingScope"
                  | "missingTarget"
                  | "scopeMismatch"
                  | "hidden"
                  | "modalBlocked"
                  | "notModal"
                  | "inactiveModal"
          }

    /**
     * Result returned by directional focus movement.
     */
    export type UiFocusMoveResult =
        | {
              kind: "moved"
              fromScopeId: UiFocusScopeId
              fromTargetId?: UiFocusId
              toScopeId: UiFocusScopeId
              toTargetId: UiFocusId
              scrollRequest?: UiFocusScrollRequest
          }
        | {
              kind: "stayed"
              scopeId?: UiFocusScopeId
              targetId?: UiFocusId
              reason: "boundary" | "empty" | "missingActive"
          }
        | {
              kind: "exited"
              scopeId: UiFocusScopeId
              targetId?: UiFocusId
              direction: UiFocusDirection
          }

    /**
     * Result returned when the current focus is activated.
     */
    export type UiFocusActivationResult =
        | { kind: "activated"; scopeId: UiFocusScopeId; targetId: UiFocusId }
        | {
              kind: "notActivated"
              scopeId?: UiFocusScopeId
              targetId?: UiFocusId
              reason:
                  | "missingActive"
                  | "missingTarget"
                  | "hidden"
                  | "notActivatable"
          }

    /**
     * Result returned when cancellation is requested.
     */
    export type UiFocusCancelResult =
        | { kind: "handled"; scopeId: UiFocusScopeId }
        | {
              kind: "unhandled"
              scopeId?: UiFocusScopeId
              reason: "missingActiveScope" | "notHandled"
          }

    interface UiFocusScopeRecord {
        id: UiFocusScopeId
        parentScopeId: UiFocusScopeId | undefined
        preferredTargetId: UiFocusId | undefined
        handlesCancel: boolean
        modal: boolean
        activeTargetId: UiFocusId | undefined
    }

    interface UiFocusTargetRecord {
        id: UiFocusId
        scopeId: UiFocusScopeId
        hidden: boolean
        activatable: boolean
        scrollOwnerId: UiFocusScrollOwnerId | undefined
        scrollRect: Rect | undefined
    }

    /**
     * Stores focus scopes, targets, and the current active focus.
     */
    export class UiFocusState {
        private scopes_: UiFocusScopeRecord[]
        private scopeById_: { [key: string]: UiFocusScopeRecord }
        private targets_: UiFocusTargetRecord[]
        private targetById_: { [key: string]: UiFocusTargetRecord }
        private activeScopeId_: UiFocusScopeId | undefined

        constructor() {
            this.scopes_ = []
            this.scopeById_ = {}
            this.targets_ = []
            this.targetById_ = {}
            this.activeScopeId_ = undefined
        }

        /**
         * Creates or replaces a focus scope descriptor.
         */
        public setScope(options: UiFocusScopeOptions): void {
            let scope = this.findScope(options.id)
            if (!scope) {
                scope = {
                    id: options.id,
                    parentScopeId: undefined,
                    preferredTargetId: undefined,
                    handlesCancel: false,
                    modal: false,
                    activeTargetId: undefined,
                }
                this.scopes_.push(scope)
                this.scopeById_[scope.id] = scope
            }
            scope.parentScopeId = options.parentScopeId
            scope.preferredTargetId = options.preferredTargetId
            scope.handlesCancel = options.handlesCancel || false
            scope.modal = options.modal || false
            if (!this.isTargetEligible(scope.activeTargetId, scope.id))
                scope.activeTargetId = undefined
        }

        /**
         * Removes a scope, its targets, and active focus for that scope.
         */
        public removeScope(id: UiFocusScopeId): void {
            const scopeIndex = this.findScopeIndex(id)
            if (scopeIndex < 0) return

            const scope = this.scopes_[scopeIndex]
            this.scopeById_[scope.id] = undefined
            this.scopes_.removeAt(scopeIndex)
            for (let i = this.targets_.length - 1; i >= 0; i--) {
                if (this.targets_[i].scopeId == id) {
                    this.targetById_[this.targets_[i].id] = undefined
                    this.targets_.removeAt(i)
                }
            }

            if (this.activeScopeId_ == id) {
                this.activeScopeId_ = undefined
            }
        }

        /**
         * Creates or replaces a focus target descriptor.
         */
        public setTarget(options: UiFocusTargetOptions): void {
            if (!this.findScope(options.scopeId)) return

            let target = this.findTarget(options.id)
            const oldScopeId = target ? target.scopeId : undefined

            if (!target) {
                target = {
                    id: options.id,
                    scopeId: options.scopeId,
                    hidden: false,
                    activatable: false,
                    scrollOwnerId: undefined,
                    scrollRect: undefined,
                }
                this.targets_.push(target)
                this.targetById_[target.id] = target
            }

            target.scopeId = options.scopeId
            target.hidden = options.hidden || false
            target.activatable = options.activatable || false
            target.scrollOwnerId = options.scrollOwnerId
            if (options.scrollRect) {
                if (!target.scrollRect) target.scrollRect = new Rect()
                copyArrangedLayoutRect(target.scrollRect, options.scrollRect)
            } else {
                target.scrollRect = undefined
            }

            if (oldScopeId && oldScopeId != options.scopeId) {
                this.clearRetainedActiveTarget(oldScopeId, options.id)
            }

            if (!this.isTargetEligible(options.id, options.scopeId)) {
                this.clearRetainedActiveTarget(options.scopeId, options.id)
            }
        }

        /**
         * Returns the current active scope id.
         */
        public getActiveScopeId(): UiFocusScopeId | undefined {
            return this.activeScopeId_
        }

        /**
         * Returns the stored active target for a scope.
         */
        public getActiveTargetId(
            scopeId?: UiFocusScopeId,
        ): UiFocusId | undefined {
            const resolvedScopeId =
                scopeId === undefined ? this.activeScopeId_ : scopeId
            const scope = this.findScope(resolvedScopeId)
            return scope ? scope.activeTargetId : undefined
        }

        /**
         * Makes a scope active and focuses its stored or preferred target when available.
         */
        public setActiveScope(scopeId: UiFocusScopeId): UiFocusSetResult {
            const scope = this.findScope(scopeId)
            if (!scope)
                return { kind: "rejected", scopeId, reason: "missingScope" }
            if (this.isFocusBlockedByModal(scopeId))
                return { kind: "rejected", scopeId, reason: "modalBlocked" }

            return this.activateScope(scope)
        }

        /**
         * Clears the active scope without clearing each scope's stored active target.
         */
        public clearActiveScope(): UiFocusSetResult {
            if (this.activeScopeId_ === undefined) {
                return { kind: "unchanged", reason: "alreadyClear" }
            }

            const previousScopeId = this.activeScopeId_
            this.activeScopeId_ = undefined
            const result: UiFocusSetResult = {
                kind: "cleared",
                scopeId: previousScopeId,
            }
            return result
        }

        /**
         * Makes a target active within its scope.
         */
        public setActiveTarget(
            scopeId: UiFocusScopeId,
            targetId: UiFocusId,
        ): UiFocusSetResult {
            const scope = this.findScope(scopeId)
            if (!scope)
                return {
                    kind: "rejected",
                    scopeId,
                    targetId,
                    reason: "missingScope",
                }
            if (this.isFocusBlockedByModal(scopeId)) {
                return {
                    kind: "rejected",
                    scopeId,
                    targetId,
                    reason: "modalBlocked",
                }
            }

            const target = this.findTarget(targetId)
            if (!target)
                return {
                    kind: "rejected",
                    scopeId,
                    targetId,
                    reason: "missingTarget",
                }
            if (target.scopeId != scopeId)
                return {
                    kind: "rejected",
                    scopeId,
                    targetId,
                    reason: "scopeMismatch",
                }
            if (target.hidden)
                return { kind: "rejected", scopeId, targetId, reason: "hidden" }

            if (
                this.activeScopeId_ == scopeId &&
                scope.activeTargetId == targetId
            ) {
                return {
                    kind: "unchanged",
                    scopeId,
                    targetId,
                    reason: "alreadyFocused",
                }
            }

            scope.activeTargetId = targetId
            this.activeScopeId_ = scopeId
            const result = this.focusedResult(scopeId, targetId)
            return result
        }

        /**
         * Reports whether the active target can be activated.
         */
        public activate(): UiFocusActivationResult {
            const scope = this.findScope(this.activeScopeId_)
            if (!scope || scope.activeTargetId === undefined) {
                return {
                    kind: "notActivated",
                    scopeId: this.activeScopeId_,
                    reason: "missingActive",
                }
            }

            const target = this.findTarget(scope.activeTargetId)
            if (!target) {
                return {
                    kind: "notActivated",
                    scopeId: scope.id,
                    targetId: scope.activeTargetId,
                    reason: "missingTarget",
                }
            }
            if (target.hidden)
                return {
                    kind: "notActivated",
                    scopeId: scope.id,
                    targetId: target.id,
                    reason: "hidden",
                }
            if (!target.activatable) {
                return {
                    kind: "notActivated",
                    scopeId: scope.id,
                    targetId: target.id,
                    reason: "notActivatable",
                }
            }
            return { kind: "activated", scopeId: scope.id, targetId: target.id }
        }

        /**
         * Reports the nearest active scope or ancestor that handles cancellation.
         */
        public cancel(): UiFocusCancelResult {
            const scope = this.findScope(this.activeScopeId_)
            if (!scope)
                return {
                    kind: "unhandled",
                    scopeId: this.activeScopeId_,
                    reason: "missingActiveScope",
                }
            let current: UiFocusScopeRecord | undefined = scope

            for (let i = 0; i < this.scopes_.length && current; i++) {
                if (current.handlesCancel)
                    return { kind: "handled", scopeId: current.id }
                if (
                    current.parentScopeId === undefined ||
                    current.parentScopeId == current.id
                )
                    break
                current = this.findScope(current.parentScopeId)
            }

            return {
                kind: "unhandled",
                scopeId: scope.id,
                reason: "notHandled",
            }
        }

        /**
         * Deactivates the active modal scope and restores focus to its parent.
         */
        public closeModalScope(scopeId: UiFocusScopeId): UiFocusSetResult {
            const scope = this.findScope(scopeId)
            if (!scope)
                return { kind: "rejected", scopeId, reason: "missingScope" }
            if (!scope.modal)
                return { kind: "rejected", scopeId, reason: "notModal" }

            if (this.activeScopeId_ != scopeId) {
                return { kind: "rejected", scopeId, reason: "inactiveModal" }
            }

            const parent = this.findScope(scope.parentScopeId)
            if (!parent) return this.clearActiveScope()
            return this.activateScope(parent)
        }

        private findScope(
            id: UiFocusScopeId | undefined,
        ): UiFocusScopeRecord | undefined {
            return id === undefined ? undefined : this.scopeById_[id]
        }

        private findScopeIndex(id: UiFocusScopeId | undefined): number {
            if (id === undefined) return -1
            for (let i = 0; i < this.scopes_.length; i++) {
                if (this.scopes_[i].id == id) return i
            }
            return -1
        }

        private findTarget(
            id: UiFocusId | undefined,
        ): UiFocusTargetRecord | undefined {
            return id === undefined ? undefined : this.targetById_[id]
        }

        private isTargetEligible(
            targetId: UiFocusId | undefined,
            scopeId: UiFocusScopeId,
        ): boolean {
            const target = this.findTarget(targetId)
            return !!target && target.scopeId == scopeId && !target.hidden
        }

        /**
         * Drops a scope's retained target when that target is no longer
         * eligible. When the scope is active, focus is re-resolved to the
         * scope's preferred target so that hiding the focused control does not
         * strand focus on something no movement can start from.
         */
        private clearRetainedActiveTarget(
            scopeId: UiFocusScopeId,
            targetId: UiFocusId,
        ): void {
            const scope = this.findScope(scopeId)
            if (!scope || scope.activeTargetId != targetId) return
            scope.activeTargetId = undefined
            if (this.activeScopeId_ == scopeId) this.activateScope(scope)
        }

        private activateScope(scope: UiFocusScopeRecord): UiFocusSetResult {
            let targetId = this.isTargetEligible(scope.activeTargetId, scope.id)
                ? scope.activeTargetId
                : undefined
            if (
                !targetId &&
                this.isTargetEligible(scope.preferredTargetId, scope.id)
            )
                targetId = scope.preferredTargetId

            if (targetId) {
                if (
                    this.activeScopeId_ == scope.id &&
                    scope.activeTargetId == targetId
                ) {
                    return {
                        kind: "unchanged",
                        scopeId: scope.id,
                        targetId,
                        reason: "alreadyFocused",
                    }
                }
                scope.activeTargetId = targetId
                this.activeScopeId_ = scope.id
                const result = this.focusedResult(scope.id, targetId)
                return result
            }

            this.activeScopeId_ = scope.id
            const result: UiFocusSetResult = {
                kind: "unchanged",
                scopeId: scope.id,
                reason: "empty",
            }
            return result
        }

        private isFocusBlockedByModal(scopeId: UiFocusScopeId): boolean {
            let scope = this.findScope(this.activeScopeId_)
            return !!scope && scope.modal && scope.id != scopeId
        }

        private focusedResult(
            scopeId: UiFocusScopeId,
            targetId: UiFocusId,
        ): UiFocusSetResult {
            const result: UiFocusSetResult = {
                kind: "focused",
                scopeId,
                targetId,
            }
            const target = this.findTarget(targetId)
            if (
                !target ||
                target.scrollOwnerId === undefined ||
                !target.scrollRect
            )
                return result
            result.scrollRequest = {
                scopeId,
                targetId,
                scrollOwnerId: target.scrollOwnerId,
                targetRect: target.scrollRect.clone(),
                reason: "focus",
            }
            return result
        }
    }
}
