export declare const operatorPayloadSchema: {
    type: string;
    properties: {
        version: {
            type: string;
        };
        enr: {
            type: string;
        };
    };
    required: string[];
};
export declare const definitionSchema: {
    type: string;
    properties: {
        name: {
            type: string;
        };
        operators: {
            type: string;
            minItems: number;
            uniqueItems: boolean;
            items: {
                type: string;
                properties: {
                    address: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                };
                required: string[];
            };
        };
        validators: {
            type: string;
            minItems: number;
            items: {
                type: string;
                properties: {
                    fee_recipient_address: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    withdrawal_address: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                };
                required: string[];
            };
        };
    };
    required: string[];
};
