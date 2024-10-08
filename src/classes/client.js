const { Client, GatewayIntentBits, Partials, ActivityType, Events } = require('discord.js');
const { showLoadingStart, showLoadingStatus, showLoadingEnd } = require('../loaders/handler');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { Var } = require('./variables');

class ERXClient {
    constructor({ intents, prefix, token, variable = {} }) {
        this.intents = intents;
        this.prefix = prefix;
        this.token = token;
        this.commands = new Map();
        this.interactions = new Map();
        this.bot = new Client({
            intents: this.intents,
            partials: [Partials.Channel],
        });

        if (variable.enabled) {
            const variableFolder = variable.folder || './variables';

            if (!fs.existsSync(variableFolder)) {
                if (variable.folder) {
                    console.log(chalk.red(`✖ The folder "${variableFolder}" does not exist.`));
                } else {
                    fs.mkdirSync(variableFolder, { recursive: true });
                    console.log(chalk.green(`✔ Created default variables folder at "${variableFolder}"`));
                }
            }

            this.variableFolder = variableFolder;
        }

        Var.setClient(this);
    }

    new_variable({ name, value }) {
        if (!this.variableFolder) {
            throw new Error('Variable folder is not set. Ensure the "variable" option is configured correctly.');
        }

        const variable = new Var({
            name: name,
            value: value,
            folder: this.variableFolder
        });
    }

    setMaxListeners(max) {
        if (typeof max === 'number') {
            this.bot.setMaxListeners(max);
        } else {
            throw new Error('"max" must be a number. Make sure you don\'t put a high number.');
        }
    }

    ready(callback) {
        this.bot.once(Events.ClientReady, async () => {
            await callback();
        });
    }

    start() {
        this.bot.login(this.token);
    }

    kill() {
        this.bot.destroy();
    }

    command({ name, content }) {
        this.commands.set(name.toLowerCase(), content);
    }

    registerCommands() {
        this.bot.on(Events.MessageCreate, async (msg) => {
            if (msg.author.bot || msg.webhookId) return;
            if (!msg.content.startsWith(this.prefix)) return;

            const args = msg.content.slice(this.prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();

            const command = this.commands.get(commandName);
            if (command) {
                await command(msg);
            }
        });
    }

    handler(commandsPath, showLoad = false) {
        const absolutePath = path.resolve(commandsPath);
        
        let failedCommands = 0;
    
        if (showLoad) {
            showLoadingStart();
        }
    
        const maxLength = 50;
    
        const loadCommands = (dir) => {
            const files = fs.readdirSync(dir);
    
            files.forEach(file => {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
    
                if (stat.isDirectory()) {
                    loadCommands(filePath);
                } else if (file.endsWith('.js')) {
                    try {
                        const command = require(filePath);
                        const commandName = command.name || file.replace('.js', '');
                        const commandType = command.type || 'command';
                        const typeLabel = commandType === 'interaction' ? chalk.gray('(type: interaction)') : chalk.gray('(default: command)');
                        const fullLabel = `${commandName} ${typeLabel}`;
                        
                        const paddedLabel = fullLabel.padEnd(maxLength, ' ');
    
                        if (commandType === 'interaction') {
                            this.interaction({ id: commandName, content: command.content });
                        } else {
                            this.command({ name: commandName, content: command.content });
                        }
    
                        if (showLoad) {
                            showLoadingStatus(paddedLabel, 'success');
                        }
                    } catch (error) {
                        failedCommands++;
                        if (showLoad) {
                            showLoadingStatus(file.padEnd(maxLength, ' '), 'error');
                        }
                    }
                }
            });
        };
    
        loadCommands(absolutePath);
    
        if (showLoad) {
            showLoadingEnd(failedCommands, fs.readdirSync(absolutePath).length);
        }
    }

    event(name, callback) {
        const eventPath = path.join(__dirname, '../events', `${name}.js`);

        if (fs.existsSync(eventPath)) {
            const event = require(eventPath);
            this.bot.on(event.trigger, async (...args) => {
                if (event.condition(...args)) {
                    await callback(...args);
                }
            });
        } else if (Object.values(Events).includes(name)) {
            this.bot.on(name, async (...args) => {
                await callback(...args);
            });
        } else {
            throw new Error(`Event "${name}" not found in the events directory or Discord.js.`);
        }
    }

    presence({ time, activities, status = 'online' }) {
        if (!Array.isArray(activities) || activities.length === 0) {
            throw new Error('"activities" must be a non-empty array.');
        }

        this.bot.once(Events.ClientReady, () => {
            let currentIndex = 0;

            const updatePresence = () => {
                const activity = activities[currentIndex];
                if (activity) {
                    const activityType = this.getActivityType(activity.type);
                    this.bot.user.setPresence({
                        activities: [{ name: activity.content, type: activityType }],
                        status: status.toLowerCase()
                    });
                    currentIndex = (currentIndex + 1) % activities.length;
                }
            };

            updatePresence();
            setInterval(updatePresence, time * 1000);
        });
    }

    getActivityType(type) {
        switch (type.toLowerCase()) {
            case 'playing':
                return ActivityType.Playing;
            case 'streaming':
                return ActivityType.Streaming;
            case 'listening':
                return ActivityType.Listening;
            case 'watching':
                return ActivityType.Watching;
            case 'competing':
                return ActivityType.Competing;
            default:
                return ActivityType.Playing;
        }
    }

    interaction({ id, content }) {
        this.interactions.set(id, content);
    }

    registerInteractions() {
        this.bot.on(Events.InteractionCreate, async (interaction) => {
            if (
                interaction.isButton() || 
                interaction.isStringSelectMenu() || 
                interaction.isUserSelectMenu() || 
                interaction.isChannelSelectMenu()
            ) {
                const interactionHandler = this.interactions.get(interaction.customId);

                if (interactionHandler) {
                    await interactionHandler(interaction);
                }
            }
        });
    }
}

module.exports = ERXClient;