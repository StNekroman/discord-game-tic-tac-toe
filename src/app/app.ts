import {
    ActionRow, Button, ButtonClickGameEvent, ButtonStyle, DiscordApi, EventType, GameEvent, GamePluginEntryPoint, GameUser, JoinGameEvent, LeaveGameEvent, MessageDescriptor, Serializable, SystemButtonIds
} from "discord-text-games-api";


interface SaveBundle {
    started : boolean;
    stale : boolean;
    channelId : string;
    gameBoardMessageDescriptor ?: MessageDescriptor;
    currentPlayerIndex ?: 0|1;
    lastTurnMessageId ?: string;
    acceptSelection : boolean;
    possibleTurnsCount : number;
    gameSize : number;
    players : GameUser[];
    boardStates : (0|1|undefined)[][];
    playerIcons : {0: string, 1: string};
}

function isDefined<T>(value: T) : value is Exclude<T, null|undefined> {
    return value !== undefined && value !== null;
}

export default class TicTacToe implements GamePluginEntryPoint<SaveBundle> {
    private static readonly LEAVE_BUTTON = new Button({
        style: ButtonStyle.Primary,
        custom_id: SystemButtonIds.LEAVE_SESSION,
        label: "Leave game"
    });

    public discordApi !: DiscordApi;

    private state !: SaveBundle;

    private readonly gameSize : number;
    private readonly playerIcons;

    constructor(args ?: string) {
        this.gameSize = 3;
        if (isDefined(args)) {
            const icons = args.split(" ");
            this.playerIcons = {
                0: icons[0],
                1: icons[1]
            };
        } else {
            this.playerIcons = {
                0: "❌",
                1: "⭕"
            };
        }
	}

    public initialize(saveBundle ?: SaveBundle): Promise<void> {
        if (saveBundle) {
            // pick and restore previous state
            this.state = saveBundle;
            return Promise.resolve();
        } else {
            return this.discordApi.createChannel("Tic tac toe").then(channelId => {
                this.state = {
                    started : false,
                    stale : false,
                    channelId : channelId,
                    gameBoardMessageDescriptor : undefined,
                    currentPlayerIndex : undefined,
                    lastTurnMessageId : undefined,
                    acceptSelection : false,
                    possibleTurnsCount : Math.pow(this.gameSize, 2),
                    players : [],
                    gameSize : this.gameSize,
                    boardStates : [
                        [undefined, undefined, undefined],
                        [undefined, undefined, undefined],
                        [undefined, undefined, undefined]
                    ],
                    playerIcons : this.playerIcons
                };
            });
        }
    }

    public destroy(): Promise<Serializable<SaveBundle>|void> {
        if (!this.state.stale) {
            // save current state
            return Promise.resolve(this.state);
        } else {
            return Promise.resolve();
        }
    }

    public onEvent(event : GameEvent): void {
        if (event.type === EventType.JOIN) {
            this.handleJoin(event as JoinGameEvent);
        } else if (event.type === EventType.LEAVE) {
            this.handleLeave(event as LeaveGameEvent);
        } else if (event.type === EventType.BUTTON_CLICK) {
            this.handleButtonClick(event as ButtonClickGameEvent);
        }
    }

    private handleJoin(event : JoinGameEvent) {
        if (this.state.started) {
            this.discordApi.sendPrivateMessage(event.user.id, "The game was already started - no new joins allowed.");
            return;
        }
        if (this.state.stale) {
            this.discordApi.sendPrivateMessage(event.user.id, "The game was already finished - no new joins allowed.");
            return;
        }

        this.state.players.push(event.user);
        this.discordApi.addUserToChannel(event.user.id, this.state.channelId, true);

        if (this.state.players.length === 1) {
            this.discordApi.sendMessage(`<@${event.user.id}> joined the game.\nWaiting for one more player...`, this.state.channelId);
        } else if (this.state.players.length === 2) {
            this.discordApi.sendMessage(`<@${event.user.id}> joined the game.\nStarting game...`, this.state.channelId);
            this.startGame();
        }
    }

    private handleLeave(event : LeaveGameEvent) : void {
        const userIndex = this.state.players.map(user => user.id).indexOf(event.user.id);
        if (userIndex !== -1) {
            this.state.players.splice(userIndex, 1);
            if (this.state.players.length > 0) {
                if (!this.state.stale) {
                    this.discordApi.sendMessage(`User <@${event.user.id}> has left the game.\nThis game session become stale.\nLeave the session.`, this.state.channelId, {
                        components: [new ActionRow([TicTacToe.LEAVE_BUTTON])]
                    });
                }
                this.discordApi.removeUserFromChannel(event.user.id, this.state.channelId);
            }
            this.state.stale = true;
        }
    }

    private startGame() : void {
        this.state.started = true;
        this.discordApi.sendMessage(`<@${this.state.players[0].id}> will use ${this.state.playerIcons[0]}\n<@${this.state.players[1].id}> will use ${this.state.playerIcons[1]}`,
        this.state.channelId, {
            components: this.buildTicTacToe()
        }).then(messageDescriptor => this.state.gameBoardMessageDescriptor = messageDescriptor).then(() => {
            this.state.currentPlayerIndex = Math.round(Math.random()) as 0|1;
            this.sendTurnNotification().then(() => {
                this.state.acceptSelection = true;
            });
        });
    }

    private sendTurnNotification() : Promise<void> {
        let promise : Promise<void>;
        if (this.state.lastTurnMessageId) {
            promise = this.discordApi.deleteMessage(this.state.channelId, this.state.lastTurnMessageId);
        } else {
            promise = Promise.resolve();
        }
        return promise.then(() => this.discordApi.sendMessage(`<@${this.state.players[this.state.currentPlayerIndex!].id}>, it's your turn!`, this.state.channelId, {
            allowedMentions: [this.state.players[this.state.currentPlayerIndex!].id]
        }).then(md => {
            this.state.lastTurnMessageId = md.messageId;
        }));
    }

    private getCellIcon(row: number, index: number) : [string, boolean?] {
        const selection = this.state.boardStates[row][index];
        if (isDefined(selection)) {
            const icon = this.state.playerIcons[selection];
            return [icon, icon.length > 1];
        } else {
            return [" "];
        }
    }

    private buildTicTacToe(disabled ?: boolean) : ActionRow<Button>[] {
        const rows : ActionRow<Button>[] = [];
        for (let rowIndex = 0; rowIndex < this.state.gameSize; rowIndex++) {
            const buttons : Button[] = [];
            for (let index = 0; index < this.state.gameSize; index++) {
                buttons.push(this.buildButton(rowIndex, index, disabled));
            }
            rows.push(new ActionRow(buttons));
        }
        return rows;
    }

    private buildButton(rowIndex: number, index: number, disabled ?: boolean) : Button {
        const [icon, useEmoji] = this.getCellIcon(rowIndex, index);
        return new Button({
            style: ButtonStyle.Secondary,
            label: useEmoji ? undefined : icon,
            emoji: useEmoji ? {
                name: icon
            } : undefined,
            custom_id: (rowIndex * this.state.gameSize + index).toString(),
            disabled: disabled || isDefined(this.state.boardStates[rowIndex][index])
        });
    }

    private handleButtonClick(event : ButtonClickGameEvent) {
        const buttonId : number = parseInt(event.buttonId);
        if (!this.state.stale && buttonId >= 0 && buttonId <= 8 && this.state.gameBoardMessageDescriptor) {
            if (event.user.id !== this.state.players[this.state.currentPlayerIndex!].id) {
                this.discordApi.sendMessage(`<@${event.user.id}>, it's not your turn now.`, this.state.channelId).then(md => {
                    setTimeout(() => {
                        this.discordApi.deleteMessage(md.channelId, md.messageId);
                    }, 3000);
                });
                return;
            }

            if (!this.state.acceptSelection) {
                this.discordApi.sendMessage(`<@${event.user.id}>, you already made your choise.`, this.state.channelId).then(md => {
                    setTimeout(() => {
                        this.discordApi.deleteMessage(md.channelId, md.messageId);
                    }, 3000);
                });
                return;
            }

            this.handleUserTurn(buttonId);
        }
    }

    private getCoordFromIndex(buttonId : number) : {rowIndex: number, index: number} {
        const rowIndex = Math.floor(buttonId / this.state.gameSize);
        return {
            rowIndex: rowIndex,
            index: buttonId - rowIndex * this.state.gameSize
        };
    }

    private handleUserTurn(buttonId : number) {
        const {rowIndex, index} = this.getCoordFromIndex(buttonId);
        if (isDefined(this.state.boardStates[rowIndex][index])) {
            console.warn("Wrong turn - that cell was already selected.");
            return;
        }

        this.state.possibleTurnsCount--;
        this.state.boardStates[rowIndex][index] = this.state.currentPlayerIndex;

        const winRow = this.checkForWin();
        if (winRow) {
            this.renderWinMessage(winRow);
            return;
        }

        this.state.acceptSelection = false;
        this.discordApi.replaceControl(this.state.channelId, this.state.gameBoardMessageDescriptor!.messageId, buttonId.toString(), this.buildButton(rowIndex, index)).then(() => {
            if (this.state.possibleTurnsCount === 0) {
                this.endGameDraw();
            } else {
                this.state.currentPlayerIndex = (this.state.currentPlayerIndex! + 1) % 2 as 0|1;
                this.sendTurnNotification().then(() => {
                    this.state.acceptSelection = true;
                });
            }
        });
    }

    private endGameDraw() {
        this.discordApi.deleteMessage(this.state.channelId, this.state.lastTurnMessageId!).then(() => {
            this.state.stale = true;
            this.discordApi.sendMessage("The game was ended in a draw.\nLeave the session", this.state.channelId, {
                components: [new ActionRow([TicTacToe.LEAVE_BUTTON])]
            });
        });
    }

    private checkForWin() : number[]|undefined {
        // check lines
        for (let rowIndex = 0; rowIndex < this.state.gameSize; rowIndex++) {
            const row = this.state.boardStates[rowIndex];
            if (isDefined(row[0]) && row[0] === row[1] && row[1] === row[2]) {
                return [rowIndex * this.state.gameSize, rowIndex * this.state.gameSize + 1, rowIndex * this.state.gameSize + 2];
            }
        }

        for (let colIndex = 0; colIndex < this.state.gameSize; colIndex++) {
            if (isDefined(this.state.boardStates[0][colIndex]) && this.state.boardStates[0][colIndex] === this.state.boardStates[1][colIndex] && this.state.boardStates[1][colIndex] === this.state.boardStates[2][colIndex]) {
                return [colIndex, colIndex + this.state.gameSize, colIndex + 2 * this.state.gameSize];
            }
        }

        if (isDefined(this.state.boardStates[0][0]) && this.state.boardStates[0][0] === this.state.boardStates[1][1] && this.state.boardStates[1][1] === this.state.boardStates[2][2]) {
            return [0, this.state.gameSize + 1, 2 * this.state.gameSize + 2];
        }
        if (isDefined(this.state.boardStates[2][0]) && this.state.boardStates[2][0] === this.state.boardStates[1][1] && this.state.boardStates[1][1] === this.state.boardStates[0][2]) {
            return [2 * this.state.gameSize, this.state.gameSize + 1, this.state.gameSize - 1];
        }
    }

    private renderWinMessage(winRow : number[]) {
        this.state.stale = true;

        this.discordApi.deleteMessage(this.state.channelId, this.state.lastTurnMessageId!).then(() => {
            const board : ActionRow<Button>[] = this.buildTicTacToe(true);
            for (const buttonId of winRow) {
                const {rowIndex, index} = this.getCoordFromIndex(buttonId);
                board[rowIndex].components[index].style = ButtonStyle.Success;
            }

            return this.discordApi.editMessage(this.state.gameBoardMessageDescriptor!.channelId, this.state.gameBoardMessageDescriptor!.messageId,
            `<@${this.state.players[0].id}> will use ${this.state.playerIcons[0]}\n<@${this.state.players[1].id}> will use ${this.state.playerIcons[1]}`, {
                components: board
            });
        }).then(() => {
            const {rowIndex, index} = this.getCoordFromIndex(winRow[0]);
            const winner = this.state.players[this.state.boardStates[rowIndex][index] as 0|1];
            this.discordApi.sendMessage(`User <@${winner.id}> won the game!\nGame over.\nLeave the session`, this.state.channelId, {
                allowedMentions: [winner.id],
                components: [new ActionRow([TicTacToe.LEAVE_BUTTON])]
            })
        });
    }
}
