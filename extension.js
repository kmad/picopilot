const vscode = require("vscode");
const OpenAI = require("openai");
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");

module.exports = {
  activate: (ctx) => {
    let api;
    let azureClient;

    const initAPI = async () => {
      const useAzure = vscode.workspace.getConfiguration("picopilot").get("useAzure");
      if (useAzure) {
        const endpoint = await ctx.secrets.get("azure-endpoint");
        const azureApiKey = await ctx.secrets.get("azure-api-key");
        azureClient = new OpenAIClient(endpoint, new AzureKeyCredential(azureApiKey));
      } else {
        api = new OpenAI({ apiKey: await ctx.secrets.get("openai-key") });
      }
    };

    initAPI();

    ctx.secrets.onDidChange((event) => {
      if (event.key === "openai-key" || event.key === "azure-endpoint" || event.key === "azure-api-key") initAPI();
    });

    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: "**" },
      {
        provideInlineCompletionItems: async (document, position) => {
          const useAzure = vscode.workspace.getConfiguration("picopilot").get("useAzure");
          if ((!api && !useAzure) || (!azureClient && useAzure)) {
            const res = await vscode.window.showErrorMessage(
              useAzure ? "You must configure Azure OpenAI settings!" : "You must configure an OpenAI API Key!",
              "Set Configuration"
            );
            if (res)
              await vscode.commands.executeCommand("picopilot.config");
            return;
          }

          const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
          const suffix = document.getText(new vscode.Range(position, document.positionAt(document.getText().length)));
          const prompt =
            vscode.workspace.getConfiguration("picopilot").get("prompt") || `You provide code completion results given a prefix and suffix.
Respond with a JSON object with the key 'completion' containing a suggestion to place between the prefix and suffix.
Follow existing code styles. Listen to comments at the end of the prefix. The language is "{language}".`;

          const response = await api.chat.completions.create({
              messages: [
                {
                role: "system",
                content: prompt.replace("{language}", document.languageId),
              },
                { role: "user", content: prefix },
                { role: "user", content: suffix },
              ],
              model: "gpt-4o",
              max_tokens: 500,
              response_format: { type: "json_object" },
            });
          const resp = JSON.parse(response.choices[0].message.content);
          return {
            items: [{ insertText: resp.completion.trim() }],
          };
        },
      }
    );

    vscode.commands.registerCommand("picopilot.config", async () => {
      const useAzure = await vscode.window.showQuickPick(["OpenAI", "Azure OpenAI"], {
        placeHolder: "Select the API to use",
      });

      if (useAzure === "Azure OpenAI") {
        await vscode.workspace.getConfiguration("picopilot").update("useAzure", true, vscode.ConfigurationTarget.Global);
        const endpoint = await vscode.window.showInputBox({
          title: "Azure OpenAI Endpoint",
          prompt: "Enter your Azure OpenAI endpoint",
          ignoreFocusOut: true,
        });
        const apiKey = await vscode.window.showInputBox({
          title: "Azure OpenAI API Key",
          prompt: "Enter your Azure OpenAI API Key",
          ignoreFocusOut: true,
          password: true,
        });
        const deploymentId = await vscode.window.showInputBox({
          title: "Azure OpenAI Deployment ID",
          prompt: "Enter your Azure OpenAI deployment ID (default: gpt-35-turbo)",
          ignoreFocusOut: true,
        });

        if (endpoint) await ctx.secrets.store("azure-endpoint", endpoint);
        if (apiKey) await ctx.secrets.store("azure-api-key", apiKey);
        if (deploymentId) await vscode.workspace.getConfiguration("picopilot").update("azureDeploymentId", deploymentId, vscode.ConfigurationTarget.Global);
      } else {
        await vscode.workspace.getConfiguration("picopilot").update("useAzure", false, vscode.ConfigurationTarget.Global);
        await vscode.env.openExternal(vscode.Uri.parse("https://platform.openai.com/api-keys"));
        const res = await vscode.window.showInputBox({
          title: "OpenAI API Key",
          prompt: "Generate an API Key and paste it in!",
          ignoreFocusOut: true,
          password: true,
        });
        if (res) await ctx.secrets.store("openai-key", res);
      }

      vscode.window.showInformationMessage("PicoPilot configuration updated!");
      initAPI();
    });
  },
};